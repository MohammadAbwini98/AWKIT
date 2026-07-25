/**
 * The projection allowlist (plan §8): which source fields may EVER become indexable content.
 *
 * This is the subsystem's primary privacy control, and it is deliberately the first stage in the
 * pipeline — before redaction, not after. The distinction matters:
 *
 *   - Redaction is a **filter**: it inspects text and removes what it recognises. Anything it fails
 *     to recognise passes through. It is therefore a mitigation, never a guarantee.
 *   - Projection is a **structural exclusion**: a field that is not on the allowlist is never read,
 *     so no pattern gap can leak it. There is nothing for the redactor to miss.
 *
 * Consequence for anyone extending this: adding a field here is a privacy decision, not a
 * formatting one. Prefer leaving a field out and losing some recall over indexing it and relying on
 * the redactor to clean it up afterwards.
 *
 * Framework-agnostic: no Electron, no filesystem.
 */

import type { SemanticDocumentKind, SemanticOutcome } from "./contracts/SemanticDocument";

/**
 * Fields that must NEVER be projected, whatever kind is being built.
 *
 * Matched case-insensitively against the field name a projector asks for. This is a backstop for
 * the allowlist rather than the main mechanism — a denylist alone would be exactly the
 * recognise-and-remove model this module exists to avoid — but it makes an accidental allowlist
 * entry fail loudly instead of silently indexing credentials.
 */
export const SEMANTIC_FORBIDDEN_FIELDS: readonly string[] = [
  "password",
  "passwd",
  "pwd",
  "secret",
  "secrets",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "storagestate",
  "sessionstate",
  "localstorage",
  "sessionstorage",
  "connectionstring",
  "envfile",
  "env",
  "privatekey",
  "certificate",
  "signature",
  "otp",
  "mfa",
  "pin",
  "answer",
  "securityanswer",
  // Recorder/runtime capture surfaces: these carry whatever the user typed, including into a
  // password field that was not labelled as one.
  "value",
  "inputvalue",
  "capturedvalue",
  "fillvalue",
  "typedtext",
  "clipboard"
];

export function isForbiddenField(field: string): boolean {
  const normalized = field.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SEMANTIC_FORBIDDEN_FIELDS.some((f) => normalized === f.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/**
 * Per-kind allowlists (plan §8.1–§8.5).
 *
 * Read these as "the only things this document kind is allowed to know". Notably absent by design:
 * step input values, raw error messages, full URLs, storage state, and environment data. Where a
 * concept is genuinely needed the allowlist names a DERIVED, bounded form of it instead —
 * `errorCategory` rather than the error text, `hostname` rather than the URL, `locatorStrategy`
 * rather than the selector's captured text.
 */
export const SEMANTIC_PROJECTION_ALLOWLIST: Record<SemanticDocumentKind, readonly string[]> = {
  workflow: ["workflowId", "name", "description", "tags", "flowNames", "nodeTypes", "revision", "updatedAt"],
  flow: ["flowId", "workflowId", "name", "description", "tags", "nodeTypes", "stepNames", "revision", "updatedAt"],
  "node-template": ["nodeType", "templateVersion", "displayName", "description", "category", "tags"],
  // Locator documents record WHICH STRATEGY worked, never the matched text: the accessible name of
  // a matched element can itself be user data (an account number in a table row, a person's name).
  "locator-success": [
    "workflowId",
    "flowId",
    "nodeId",
    "nodeType",
    "locatorStrategy",
    "locatorRole",
    "contextKind",
    "hostname",
    "updatedAt"
  ],
  "locator-failure": [
    "runId",
    "attemptId",
    "nodeId",
    "nodeType",
    "locatorStrategy",
    "locatorRole",
    "contextKind",
    "failureReason",
    "hostname",
    "updatedAt"
  ],
  // `errorCategory` is the classifier's bounded enum; `errorSummary` is a redacted, size-capped
  // sentence. The raw error string is NOT projectable — it routinely embeds URLs and tokens.
  "run-failure": [
    "runId",
    "attemptId",
    "workflowId",
    "flowId",
    "nodeId",
    "nodeType",
    "errorCategory",
    "errorSummary",
    "outcome",
    "hostname",
    "updatedAt"
  ],
  "run-summary": ["runId", "workflowId", "outcome", "stepCount", "failureCount", "durationMs", "hostname", "updatedAt"],
  documentation: ["relativePath", "title", "headings", "body", "tags", "updatedAt"]
};

// ── branded projection stage ─────────────────────────────────────────────────────────────────────

/** Module-private brand. Never exported, so ONLY the projectors below can produce a candidate. */
declare const projectedSemanticCandidate: unique symbol;

/**
 * Everything a document may contain, derived exclusively from allowlisted source fields.
 *
 * There is deliberately no free-form `body`: an unrestricted caller-supplied body was a hole
 * straight through the allowlist, because projection never saw it and privacy fell back entirely on
 * pattern-based redaction — the dependency this layer exists to remove. `contentParts` is assembled
 * by the projectors from allowlisted values only.
 */
export interface ProjectedFields {
  kind: SemanticDocumentKind;
  entityId: string;
  revision: string;
  title: string;
  /** Ordered `label: value` fragments, all derived from allowlisted fields. */
  contentParts: string[];
  tags: string[];
  workflowId?: string;
  flowId?: string;
  nodeId?: string;
  nodeType?: string;
  hostname?: string;
  outcome?: SemanticOutcome;
  errorCategory?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type ProjectedSemanticCandidate = ProjectedFields & {
  readonly [projectedSemanticCandidate]: true;
};

export type ProjectionRejectionReason =
  | "UNSUPPORTED_KIND"
  | "FIELD_NOT_ALLOWLISTED"
  | "FIELD_FORBIDDEN"
  | "MISSING_REQUIRED_FIELD";

export interface ProjectionRejection {
  reason: ProjectionRejectionReason;
  /** The offending field NAME only — never its value. */
  field?: string;
  kind: SemanticDocumentKind;
}

export type ProjectionResult =
  | { ok: true; projected: Record<string, unknown> }
  | { ok: false; rejections: ProjectionRejection[] };

/**
 * Project a source record down to the allowlisted fields for `kind`.
 *
 * Unknown fields are DROPPED rather than rejected: a projector reading a newer AWKIT entity that
 * grew a field must not start failing wholesale. A field that is explicitly forbidden, however, is
 * a rejection — its presence means a caller tried to index something it must never index, and
 * silently dropping it would hide a real defect in that caller.
 */
export function projectForKind(kind: SemanticDocumentKind, source: Record<string, unknown>): ProjectionResult {
  const allowed = SEMANTIC_PROJECTION_ALLOWLIST[kind];
  if (!allowed) return { ok: false, rejections: [{ reason: "UNSUPPORTED_KIND", kind }] };

  const rejections: ProjectionRejection[] = [];
  const projected: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(source)) {
    if (isForbiddenField(field)) {
      rejections.push({ reason: "FIELD_FORBIDDEN", field, kind });
      continue;
    }
    if (!allowed.includes(field)) continue; // unknown//not-indexable → silently dropped
    if (value === undefined || value === null) continue;
    projected[field] = value;
  }

  return rejections.length > 0 ? { ok: false, rejections } : { ok: true, projected };
}

// ── kind-specific projectors ─────────────────────────────────────────────────────────────────────
//
// These are the ONLY constructors of `ProjectedSemanticCandidate`. Each derives its title, content,
// tags and filter dimensions exclusively from allowlisted source properties, so a caller cannot
// submit independently-constructed indexable text. Callers pass a raw source object; what survives
// is decided here.

export type CandidateResult =
  | { ok: true; candidate: ProjectedSemanticCandidate }
  | { ok: false; rejections: ProjectionRejection[] };

function str(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function list(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.length > 0);
  return [];
}

/** Assemble `label: value` fragments from allowlisted fields only, skipping absent ones. */
function partsFrom(projected: Record<string, unknown>, fields: readonly string[]): string[] {
  const parts: string[] = [];
  for (const field of fields) {
    const value = projected[field];
    if (value === undefined || value === null) continue;
    const rendered = Array.isArray(value) ? value.join(", ") : String(value);
    if (rendered.trim().length === 0) continue;
    parts.push(`${field}: ${rendered}`);
  }
  return parts;
}

function brand(fields: ProjectedFields): ProjectedSemanticCandidate {
  return fields as ProjectedSemanticCandidate;
}

function missing(kind: SemanticDocumentKind, field: string): CandidateResult {
  return { ok: false, rejections: [{ reason: "MISSING_REQUIRED_FIELD", field, kind }] };
}

/** Shared front half: run the allowlist, then hand the surviving fields to a kind-specific builder. */
function project(
  kind: SemanticDocumentKind,
  source: Record<string, unknown>,
  build: (projected: Record<string, unknown>) => CandidateResult
): CandidateResult {
  const result = projectForKind(kind, source);
  if (!result.ok) return { ok: false, rejections: result.rejections };
  return build(result.projected);
}

export function projectWorkflowDocument(source: Record<string, unknown>): CandidateResult {
  return project("workflow", source, (p) => {
    const workflowId = str(p, "workflowId");
    if (!workflowId) return missing("workflow", "workflowId");
    return {
      ok: true,
      candidate: brand({
        kind: "workflow",
        entityId: workflowId,
        revision: str(p, "revision") ?? "0",
        title: str(p, "name") ?? workflowId,
        contentParts: partsFrom(p, ["name", "description", "flowNames", "nodeTypes"]),
        tags: list(p, "tags"),
        workflowId,
        updatedAt: str(p, "updatedAt")
      })
    };
  });
}

export function projectFlowDocument(source: Record<string, unknown>): CandidateResult {
  return project("flow", source, (p) => {
    const flowId = str(p, "flowId");
    if (!flowId) return missing("flow", "flowId");
    return {
      ok: true,
      candidate: brand({
        kind: "flow",
        entityId: flowId,
        revision: str(p, "revision") ?? "0",
        title: str(p, "name") ?? flowId,
        contentParts: partsFrom(p, ["name", "description", "nodeTypes", "stepNames"]),
        tags: list(p, "tags"),
        flowId,
        workflowId: str(p, "workflowId"),
        updatedAt: str(p, "updatedAt")
      })
    };
  });
}

export function projectNodeTemplateDocument(source: Record<string, unknown>): CandidateResult {
  return project("node-template", source, (p) => {
    const nodeType = str(p, "nodeType");
    if (!nodeType) return missing("node-template", "nodeType");
    return {
      ok: true,
      candidate: brand({
        kind: "node-template",
        entityId: nodeType,
        revision: str(p, "templateVersion") ?? "0",
        title: str(p, "displayName") ?? nodeType,
        contentParts: partsFrom(p, ["displayName", "description", "category"]),
        tags: list(p, "tags"),
        nodeType
      })
    };
  });
}

export function projectRunFailureDocument(source: Record<string, unknown>): CandidateResult {
  return project("run-failure", source, (p) => {
    const runId = str(p, "runId");
    if (!runId) return missing("run-failure", "runId");
    const outcome = str(p, "outcome");
    return {
      ok: true,
      candidate: brand({
        kind: "run-failure",
        entityId: runId,
        revision: str(p, "attemptId") ?? "0",
        title: str(p, "errorCategory") ?? "Run failure",
        // `errorSummary` is the bounded, redacted sentence the allowlist permits; the raw error
        // string is not projectable at all.
        contentParts: partsFrom(p, ["errorCategory", "errorSummary", "nodeType", "hostname"]),
        tags: [],
        workflowId: str(p, "workflowId"),
        flowId: str(p, "flowId"),
        nodeId: str(p, "nodeId"),
        nodeType: str(p, "nodeType"),
        hostname: str(p, "hostname"),
        outcome: (outcome as SemanticOutcome | undefined) ?? "failure",
        errorCategory: str(p, "errorCategory"),
        updatedAt: str(p, "updatedAt")
      })
    };
  });
}

export function projectRunSummaryDocument(source: Record<string, unknown>): CandidateResult {
  return project("run-summary", source, (p) => {
    const runId = str(p, "runId");
    if (!runId) return missing("run-summary", "runId");
    return {
      ok: true,
      candidate: brand({
        kind: "run-summary",
        entityId: runId,
        revision: "0",
        title: `Run ${runId}`,
        contentParts: partsFrom(p, ["outcome", "stepCount", "failureCount", "durationMs", "hostname"]),
        tags: [],
        workflowId: str(p, "workflowId"),
        hostname: str(p, "hostname"),
        outcome: str(p, "outcome") as SemanticOutcome | undefined,
        updatedAt: str(p, "updatedAt")
      })
    };
  });
}

export function projectDocumentationDocument(source: Record<string, unknown>): CandidateResult {
  return project("documentation", source, (p) => {
    const relativePath = str(p, "relativePath");
    if (!relativePath) return missing("documentation", "relativePath");
    return {
      ok: true,
      candidate: brand({
        kind: "documentation",
        entityId: relativePath,
        revision: "0",
        title: str(p, "title") ?? relativePath,
        contentParts: partsFrom(p, ["title", "headings", "body"]),
        tags: list(p, "tags"),
        updatedAt: str(p, "updatedAt")
      })
    };
  });
}

function projectLocator(kind: "locator-success" | "locator-failure", source: Record<string, unknown>): CandidateResult {
  return project(kind, source, (p) => {
    const nodeId = str(p, "nodeId");
    if (!nodeId) return missing(kind, "nodeId");
    const runId = str(p, "runId");
    const entityId = kind === "locator-failure" ? (runId ?? nodeId) : `${str(p, "flowId") ?? ""}:${nodeId}`;
    return {
      ok: true,
      candidate: brand({
        kind,
        entityId,
        revision: str(p, "attemptId") ?? "0",
        title: `${str(p, "locatorStrategy") ?? "locator"} on ${str(p, "nodeType") ?? "node"}`,
        // Strategy/role/context-kind only — never the matched element text, which routinely carries
        // user data (an account number in a table row, a person name on a card).
        contentParts: partsFrom(p, ["locatorStrategy", "locatorRole", "contextKind", "failureReason", "nodeType"]),
        tags: [],
        workflowId: str(p, "workflowId"),
        flowId: str(p, "flowId"),
        nodeId,
        nodeType: str(p, "nodeType"),
        hostname: str(p, "hostname"),
        updatedAt: str(p, "updatedAt")
      })
    };
  });
}

export const projectLocatorSuccessDocument = (source: Record<string, unknown>): CandidateResult =>
  projectLocator("locator-success", source);
export const projectLocatorFailureDocument = (source: Record<string, unknown>): CandidateResult =>
  projectLocator("locator-failure", source);

/** Dispatch by kind, for callers driven by data rather than a static call site. */
export const SEMANTIC_PROJECTORS: Record<SemanticDocumentKind, (source: Record<string, unknown>) => CandidateResult> = {
  workflow: projectWorkflowDocument,
  flow: projectFlowDocument,
  "node-template": projectNodeTemplateDocument,
  "run-failure": projectRunFailureDocument,
  "run-summary": projectRunSummaryDocument,
  documentation: projectDocumentationDocument,
  "locator-success": projectLocatorSuccessDocument,
  "locator-failure": projectLocatorFailureDocument
};
