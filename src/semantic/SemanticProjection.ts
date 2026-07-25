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

import type { SemanticDocumentKind } from "./contracts/SemanticDocument";

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

export type ProjectionRejectionReason =
  | "UNSUPPORTED_KIND"
  | "FIELD_NOT_ALLOWLISTED"
  | "FIELD_FORBIDDEN";

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
