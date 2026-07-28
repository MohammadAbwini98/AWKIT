/**
 * The renderer-facing semantic contract (plan §11).
 *
 * Everything crossing IPC is defined and SANITIZED here, in one pure module, so the main-process
 * handler and its verifier apply identical rules. The handler is the enforcement point — the renderer
 * is untrusted — but the rules themselves must not live inside the handler, or a verifier can only
 * re-assert them by copying them.
 *
 * Contract rules being enforced (§11.3):
 *   - bounded strings and arrays;
 *   - a strict `topK` maximum;
 *   - filters are STRUCTURED fields, never a raw Zvec expression from the renderer;
 *   - no renderer-supplied collection path or filesystem path;
 *   - no raw native error crosses IPC — only stable reason codes.
 *
 * Framework-agnostic: no Electron, no filesystem, no React.
 */

import {
  isSemanticDocumentKind,
  SEMANTIC_DEFAULT_TOP_K,
  SEMANTIC_MAX_TOP_K,
  type SemanticDocumentKind,
  type SemanticSearchHit,
  type SemanticSearchRequest
} from "./SemanticDocument";
import type { SemanticHealth } from "./SemanticHealth";

/** Longest free-text query accepted. A query is a phrase, not a document. */
export const SEMANTIC_MAX_QUERY_LENGTH = 512;
/** Longest structured filter value (workflowId, hostname, …). */
export const SEMANTIC_MAX_FILTER_LENGTH = 200;
/** Most document kinds one request may name. Bounded so a request cannot enumerate unboundedly. */
export const SEMANTIC_MAX_KINDS = 8;

/**
 * Stable reason codes. The renderer switches on these; it never parses a message, and a native or
 * vendor error string never reaches it.
 */
export type SemanticReasonCode =
  | "OK"
  | "NOT_AVAILABLE"
  | "INDEX_NOT_READY"
  | "INVALID_REQUEST"
  | "SEARCH_FAILED"
  | "REBUILD_REFUSED"
  | "CLEAR_FAILED"
  | "SETTINGS_REJECTED"
  | "NOT_SUPPORTED";

export interface SemanticStatusView {
  health: SemanticHealth;
  /** Mirrors the runtime; all false/zero when no runtime is registered. */
  index: {
    activeGeneration: string | null;
    writable: boolean;
    rebuildRequired: boolean;
    pendingMutations: number;
    reconciliationRequired: boolean;
  };
}

export interface SemanticSearchResponse {
  code: SemanticReasonCode;
  hits: SemanticSearchHit[];
  /** True when the backend answered from a degraded mode (e.g. no vector search available). */
  degraded: boolean;
  /** Present only when `code !== "OK"`. A short, safe sentence — never a native message. */
  message?: string;
}

export interface SemanticAdminResponse {
  code: SemanticReasonCode;
  ok: boolean;
  message?: string;
  /** Populated by rebuild: the generation that became active, when one did. */
  generation?: string;
  populated?: number;
}

export interface SemanticSettingsView {
  enabled: boolean;
  defaultTopK: number;
  /** Hard ceiling the renderer must not exceed; surfaced so the UI can bound its own control. */
  maxTopK: number;
}

export interface SemanticSettingsPatch {
  enabled?: boolean;
  defaultTopK?: number;
}

export type SemanticSanitizeResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, max);
}

/**
 * Turn an untrusted renderer payload into a `SemanticSearchRequest`.
 *
 * Unknown properties are DROPPED rather than rejected — a newer renderer must not fail wholesale
 * against an older main process. But a value that is present and malformed IS an error: silently
 * discarding a filter the caller asked for would widen the search instead of narrowing it, and the
 * caller would never know its constraint was ignored.
 */
export function sanitizeSearchRequest(input: unknown): SemanticSanitizeResult<SemanticSearchRequest> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["Search request must be an object."] };
  }
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];

  const text = boundedString(raw.text, SEMANTIC_MAX_QUERY_LENGTH);
  if (text === undefined) errors.push("Search text must be a non-empty string.");

  let kinds: SemanticDocumentKind[] | undefined;
  if (raw.kinds !== undefined) {
    if (!Array.isArray(raw.kinds)) {
      errors.push("Search kinds must be an array.");
    } else if (raw.kinds.length > SEMANTIC_MAX_KINDS) {
      errors.push(`Search may name at most ${SEMANTIC_MAX_KINDS} kinds.`);
    } else {
      const unknown = raw.kinds.filter((k) => !isSemanticDocumentKind(k));
      if (unknown.length > 0) errors.push("Search kinds contain an unrecognised document kind.");
      else kinds = raw.kinds as SemanticDocumentKind[];
    }
  }

  let topK = SEMANTIC_DEFAULT_TOP_K;
  if (raw.topK !== undefined) {
    if (typeof raw.topK !== "number" || !Number.isInteger(raw.topK) || raw.topK < 1) {
      errors.push("Search topK must be a positive integer.");
    } else {
      // Clamped, not rejected: an over-large topK is a bounded request, not an attack, and failing it
      // would make the ceiling a breaking change every time it moves.
      topK = Math.min(raw.topK, SEMANTIC_MAX_TOP_K);
    }
  }

  // Evaluated ONCE per field and collected into a map. Calling the helper inline in both the
  // condition and the value would run it twice and record every malformed filter as two errors.
  const scalars: Partial<Record<"workflowId" | "flowId" | "nodeType" | "hostname" | "errorCategory", string>> = {};
  for (const field of ["workflowId", "flowId", "nodeType", "hostname", "errorCategory"] as const) {
    if (raw[field] === undefined) continue;
    const value = boundedString(raw[field], SEMANTIC_MAX_FILTER_LENGTH);
    if (value === undefined) errors.push(`Search ${field} must be a non-empty string when provided.`);
    else scalars[field] = value;
  }

  const request: SemanticSearchRequest = {
    text: text ?? "",
    topK,
    ...(kinds ? { kinds } : {}),
    ...scalars
  };

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: request };
}

/** Validate a settings patch. `defaultTopK` is bounded by the same ceiling the search path enforces. */
export function sanitizeSettingsPatch(input: unknown): SemanticSanitizeResult<SemanticSettingsPatch> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["Settings patch must be an object."] };
  }
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];
  const patch: SemanticSettingsPatch = {};

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") errors.push("Semantic enabled must be true or false.");
    else patch.enabled = raw.enabled;
  }
  if (raw.defaultTopK !== undefined) {
    if (
      typeof raw.defaultTopK !== "number" ||
      !Number.isInteger(raw.defaultTopK) ||
      raw.defaultTopK < 1 ||
      raw.defaultTopK > SEMANTIC_MAX_TOP_K
    ) {
      errors.push(`Semantic default result count must be an integer between 1 and ${SEMANTIC_MAX_TOP_K}.`);
    } else {
      patch.defaultTopK = raw.defaultTopK;
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: patch };
}
