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

// Values come from the PURE module; only types come from `SemanticDocument.ts`, which imports
// `node:crypto` and therefore cannot be bundled into the renderer. Renderer surfaces import this
// contract for its bounds and reason codes, so a value import from `SemanticDocument.ts` here would
// break the renderer build — see `SemanticKinds.ts`.
import {
  isSemanticDocumentKind,
  SEMANTIC_DEFAULT_TOP_K,
  SEMANTIC_MAX_TOP_K,
  type SemanticDocumentKind
} from "./SemanticKinds";
import type { SemanticSearchHit, SemanticSearchRequest } from "./SemanticDocument";
// Pure: a frozen reason-code map and an `Error` subclass, no platform imports.
import { AuthReason, SecurityError } from "../../security/errors/ReasonCodes";
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
 *
 * `REAUTH_REQUIRED` and `NOT_AUTHORIZED` exist because the two are **not** interchangeable to a
 * user: the first is recoverable by confirming a password and retrying, the second is not
 * recoverable at all. `SEMANTIC_MANAGE_INDEX` is in `SENSITIVE_PERMISSIONS`, so a stale re-auth
 * window is the ordinary case for an authorized administrator, not an error. Without a code for it
 * the renderer could only tell the two apart by matching the text of a rejected `invoke`, which the
 * rule above forbids.
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
  | "NOT_SUPPORTED"
  /** A sensitive action needs a fresh password confirmation. Recoverable: re-auth, then retry once. */
  | "REAUTH_REQUIRED"
  /** The caller lacks the permission, or the session died. Not recoverable by retrying. */
  | "NOT_AUTHORIZED";

/**
 * Authorize a mutating semantic call and translate the outcome into a contract reason code.
 *
 * Pure and Electron-free on purpose: the authorization *check* belongs to the main process, but the
 * **rule for turning its failure into a reason code** belongs here, where the handler and its
 * verifier apply the identical version of it. `assert` is injected so a verifier can drive every
 * branch — including the one that must not be a branch at all.
 *
 * Only `SecurityError` is caught. **Anything else rethrows.** Reporting a programming fault as
 * `NOT_AUTHORIZED` would turn a crash into a plausible permission message that a user would act on,
 * and would hide the defect from whoever has to fix it.
 *
 * `SESSION_EXPIRED` folds into `NOT_AUTHORIZED` rather than getting a code of its own: the renderer's
 * security gate already tears the session down on expiry, so the user is on the login screen before
 * any message could be shown. `REAUTH_REQUIRED` is the only separable outcome, because it is the only
 * one the user can resolve without leaving the page.
 */
export async function authorizeSemanticAction(
  assert: () => Promise<unknown>
): Promise<{ ok: true } | { ok: false; code: SemanticReasonCode; message: string }> {
  try {
    await assert();
    return { ok: true };
  } catch (error) {
    if (!(error instanceof SecurityError)) throw error;
    if (error.reason === AuthReason.REAUTH_REQUIRED) {
      return { ok: false, code: "REAUTH_REQUIRED", message: "Confirm your password to continue." };
    }
    return { ok: false, code: "NOT_AUTHORIZED", message: "You are not authorized to manage the semantic index." };
  }
}

export interface SemanticStatusView {
  health: SemanticHealth;
  /** Mirrors the runtime; all false/zero when no runtime is registered. */
  index: {
    activeGeneration: string | null;
    writable: boolean;
    rebuildRequired: boolean;
    pendingMutations: number;
    reconciliationRequired: boolean;
    /** ISO time of the last successful incremental index write; null if none yet. */
    lastIndexedAt: string | null;
    /** Safe sentence for the last indexing failure; never a native message. */
    lastIndexError: string | null;
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
  /** Index each run as it finishes. Off = the index is only as fresh as the last rebuild. */
  autoIndex: boolean;
}

export interface SemanticSettingsPatch {
  enabled?: boolean;
  defaultTopK?: number;
  autoIndex?: boolean;
}

/** Find failures resembling this one. `excludeRunId` keeps the query out of its own results. */
export interface SimilarFailureRequest {
  text: string;
  workflowId?: string;
  errorCategory?: string;
  excludeRunId?: string;
  topK?: number;
}

/** Which locator strategies have worked before in this scope. */
export interface LocatorSuggestionRequest {
  workflowId?: string;
  flowId?: string;
  nodeType?: string;
  text?: string;
  topK?: number;
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

/**
 * Both derived queries reuse `sanitizeSearchRequest` for the fields they share.
 *
 * Written as a delegation rather than a second copy of the bounding rules: two sanitizers drift, and
 * the weaker one becomes the way in. Only the fields unique to each request are handled here.
 */
export function sanitizeSimilarFailureRequest(input: unknown): SemanticSanitizeResult<SimilarFailureRequest> {
  const base = sanitizeSearchRequest(input);
  if (!base.ok) return base;
  const raw = input as Record<string, unknown>;

  let excludeRunId: string | undefined;
  if (raw.excludeRunId !== undefined) {
    excludeRunId = boundedString(raw.excludeRunId, SEMANTIC_MAX_FILTER_LENGTH);
    if (excludeRunId === undefined) {
      return { ok: false, errors: ["excludeRunId must be a non-empty string when provided."] };
    }
  }

  return {
    ok: true,
    value: {
      text: base.value.text,
      topK: base.value.topK,
      ...(base.value.workflowId ? { workflowId: base.value.workflowId } : {}),
      ...(base.value.errorCategory ? { errorCategory: base.value.errorCategory } : {}),
      ...(excludeRunId ? { excludeRunId } : {})
    }
  };
}

export function sanitizeLocatorSuggestionRequest(input: unknown): SemanticSanitizeResult<LocatorSuggestionRequest> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["Locator suggestion request must be an object."] };
  }
  const raw = input as Record<string, unknown>;
  // `text` is optional here but required by the shared sanitizer, so a placeholder stands in for the
  // shared bounding pass and is then discarded. The scope filters are what actually narrow this query.
  const base = sanitizeSearchRequest({ ...raw, text: raw.text ?? "locator" });
  if (!base.ok) return base;

  return {
    ok: true,
    value: {
      topK: base.value.topK,
      ...(typeof raw.text === "string" && raw.text.trim() ? { text: base.value.text } : {}),
      ...(base.value.workflowId ? { workflowId: base.value.workflowId } : {}),
      ...(base.value.flowId ? { flowId: base.value.flowId } : {}),
      ...(base.value.nodeType ? { nodeType: base.value.nodeType } : {})
    }
  };
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
  if (raw.autoIndex !== undefined) {
    if (typeof raw.autoIndex !== "boolean") errors.push("Automatic indexing must be true or false.");
    else patch.autoIndex = raw.autoIndex;
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
