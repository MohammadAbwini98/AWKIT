/**
 * Wire-protocol definitions for the Zvec semantic native host. Mirrors the JavaScript constants in
 * `native-hosts/zvec/zvec-host.cjs` — keep the two in sync.
 *
 * Transport: an Electron `utilityProcess` MessagePort (`process.parentPort`). Framing is structured
 * clone, not bytes, so unlike the Oracle bridge there is no length prefix — but the same discipline
 * applies: every message is versioned, every request is correlated by id, and no raw native error
 * ever crosses this boundary.
 *
 * Framework-agnostic (no Electron/React imports) so verifiers and the future in-memory fake can use
 * it without an Electron runtime.
 */

import type { ZvecSafeFilter } from "./ZvecFilter";

/**
 * v2 replaced the id-only `fetch`/`query` summaries with real documents and added the typed-filter
 * operations (`scan`, `count`, `deleteByFilter`). The shape change is NOT backward compatible — a v2
 * adapter reading a v1 host would misparse every row — so the `hello` gate must reject the pairing
 * rather than let it degrade.
 */
export const ZVEC_HOST_PROTOCOL_VERSION = 2;

/**
 * Stable, path-free reason codes. Phase 0 confirmed empirically that vendor errors embed absolute
 * filesystem paths (e.g. `C:\Users\...\zvec_node_binding.node`), so raw native messages must never
 * be relayed; they are mapped onto these codes instead.
 */
export type ZvecHostReason =
  // ── raised by the host ──
  | "SEMANTIC_PATH_INVALID"
  | "SEMANTIC_PATH_OUTSIDE_APPROVED_ROOT"
  | "SEMANTIC_COLLECTION_NOT_OPEN"
  | "SEMANTIC_COLLECTION_ALREADY_OPEN"
  | "SEMANTIC_WRITE_REJECTED"
  | "SEMANTIC_UPDATE_REJECTED"
  | "SEMANTIC_DELETE_REJECTED"
  /** A delete left rows still matching its own filter — reported instead of claiming success. */
  | "SEMANTIC_DELETE_INCOMPLETE"
  /** A scan or count reached the host's row bound, so the result would be an undercount. */
  | "SEMANTIC_SCAN_BOUND_EXCEEDED"
  | "SEMANTIC_FILTER_INVALID"
  | "SEMANTIC_FILTER_FIELD_REJECTED"
  /** The value cannot be represented in the filter grammar without corruption (see `ZvecFilter`). */
  | "SEMANTIC_FILTER_VALUE_UNSAFE"
  | "SEMANTIC_UNKNOWN_REQUEST"
  | "SEMANTIC_PROTOCOL_VIOLATION"
  | "SEMANTIC_HOST_INTERNAL_ERROR"
  // ── raised by the manager, never by the host ──
  | "SEMANTIC_HOST_EXITED"
  | "SEMANTIC_HOST_TIMEOUT"
  | "SEMANTIC_HOST_UNAVAILABLE"
  | "SEMANTIC_NATIVE_INCOMPATIBLE"
  | "SEMANTIC_CIRCUIT_OPEN"
  | "SEMANTIC_DISPOSED";

/** A native (`ZVEC_*`) error is namespaced rather than enumerated, since the vendor owns that set. */
export type ZvecHostReasonCode = ZvecHostReason | `SEMANTIC_NATIVE_${string}`;

// ─────────────────────────────── requests ───────────────────────────────

export interface ZvecSafeSchemaField {
  name: string;
  dataType: "STRING" | "INT64" | "DOUBLE" | "BOOL";
  nullable?: boolean;
  /** Presence enables a full-text index on this field. */
  fts?: { tokenizer: "standard" | "jieba" };
  /**
   * Enables a scalar inverted index, making filters on this field an indexed lookup rather than a
   * brute-force scan. Performance only — filters are correct without it, so a generation created
   * before a field gained this flag still opens and filters correctly.
   */
  invert?: boolean;
}

export interface ZvecSafeSchemaVector {
  name: string;
  dimension: number;
}

export interface ZvecSafeSchema {
  name: string;
  fields: ZvecSafeSchemaField[];
  vectors?: ZvecSafeSchemaVector[];
}

export interface ZvecSafeDocument {
  id: string;
  fields: Record<string, string | number | boolean | null>;
  vectors?: Record<string, number[]>;
}

/**
 * Structured query. The renderer never supplies a raw vendor filter expression — callers describe
 * what to match with a typed `ZvecSafeFilter`, and the HOST assembles the expression.
 *
 * `filter` is applied by the vendor as a PRE-filter, before ranking. That is a correctness property:
 * filtering after a truncated top-K silently drops matches ranked outside the unfiltered head.
 */
export interface ZvecSafeQuery {
  fieldName?: string;
  fts?: { queryString?: string; matchString?: string };
  vector?: number[];
  topK?: number;
  filter?: ZvecSafeFilter;
}

export type ZvecHostRequest =
  | { version: 2; id: string; type: "hello"; expected?: ZvecHostCompatibility }
  | { version: 2; id: string; type: "open"; generation: string; path: string; schema: ZvecSafeSchema }
  | { version: 2; id: string; type: "insert"; collectionId: string; docs: ZvecSafeDocument[] }
  | { version: 2; id: string; type: "upsert"; collectionId: string; docs: ZvecSafeDocument[] }
  | { version: 2; id: string; type: "update"; collectionId: string; docId: string; fields: Record<string, unknown> }
  | { version: 2; id: string; type: "delete"; collectionId: string; ids: string[] }
  | { version: 2; id: string; type: "deleteByFilter"; collectionId: string; filter: ZvecSafeFilter }
  | { version: 2; id: string; type: "fetch"; collectionId: string; ids: string[] }
  | { version: 2; id: string; type: "scan"; collectionId: string; filter: ZvecSafeFilter }
  | { version: 2; id: string; type: "count"; collectionId: string; filter?: ZvecSafeFilter }
  | { version: 2; id: string; type: "query"; collectionId: string; query: ZvecSafeQuery }
  | { version: 2; id: string; type: "stats"; collectionId: string }
  | { version: 2; id: string; type: "close"; collectionId: string }
  | { version: 2; id: string; type: "shutdown" };

// ─────────────────────────────── typed response values ───────────────────────────────

/** `fetch` / `scan` / `query` all return real documents in v2 — v1 returned ids only. */
export interface ZvecDocumentsResponse {
  docs: ZvecSafeDocument[];
  /** `scan`: false when the host's row bound was reached, so the set is incomplete. */
  exact?: boolean;
  /** `query`: whether the requested top-K was filled, i.e. more matches may exist. */
  truncated?: boolean;
  /**
   * `query`: matches BEFORE top-K truncation, so a caller can say "showing 20 of 137". Computed by
   * the host with a count-only pass; never inferred from the length of a truncated page.
   */
  totalMatched?: number;
  /** `query`: false when the count-only pass hit the host's scan bound, so the total is a floor. */
  totalExact?: boolean;
}

export interface ZvecCountResponse {
  count: number;
  /** False when the host's scan bound was reached. A caller must refuse rather than misreport. */
  exact: boolean;
}

export interface ZvecDeleteResponse {
  deleted: number;
}

export type ZvecHostRequestType = ZvecHostRequest["type"];

/**
 * A request minus the fields the manager owns (`version`, `id`).
 *
 * Written as a distributive conditional so `Omit` is applied to each member of the union
 * separately. A plain `Omit<ZvecHostRequest, "version" | "id">` collapses the union to its common
 * keys and silently drops per-variant fields such as `expected` and `schema`.
 */
export type ZvecHostRequestPayload = ZvecHostRequest extends infer R
  ? R extends ZvecHostRequest
    ? Omit<R, "version" | "id">
    : never
  : never;

/** What the manager asserts the host must be, checked during the `hello` handshake. */
export interface ZvecHostCompatibility {
  protocolVersion: number;
  platform: string;
  arch: string;
}

// ─────────────────────────────── responses ───────────────────────────────

export type ZvecHostResponse =
  | { version: 2; id: string; ok: true; value?: unknown }
  | { version: 2; id: string; ok: false; reason: ZvecHostReasonCode; retryable: boolean };

/** Unsolicited host → manager messages. `ready` is emitted once, immediately after startup. */
export type ZvecHostEvent =
  | { version: 2; type: "ready"; pid: number }
  | { version: 2; type: "fatal"; reason: ZvecHostReasonCode };

export interface ZvecHostHello {
  protocolVersion: number;
  versions: {
    zvec: string | null;
    binding: string | null;
    node: string;
    electron: string | null;
    napi: string | null;
    platform: string;
    arch: string;
  };
  jiebaDictDir: boolean;
  hostSourceSha256: string;
  nativeBinarySha256: string | null;
  approvedRootConfigured: string;
  compatible: boolean;
}

// ─────────────────────────────── timeouts ───────────────────────────────

/**
 * Initial bounded deadlines (plan §5.3). A timeout cancels the request at the manager; it does NOT
 * by itself kill the host, because a slow operation is not the same failure as a dead process.
 *
 * `openCollectionMs` is deliberately generous: a cold open measured 205 ms in the Phase 0D
 * benchmark but 1,500-3,100 ms in packaged app mode on first touch.
 */
export const ZVEC_HOST_TIMEOUTS = {
  spawnAndReadyMs: 10_000,
  helloMs: 10_000,
  openCollectionMs: 15_000,
  queryMs: 5_000,
  writeBatchMs: 15_000,
  closeCollectionMs: 2_000,
  gracefulShutdownMs: 2_000,
  /** Hard kill window after a graceful shutdown request goes unanswered. */
  terminateGraceMs: 250
} as const;

/**
 * Bounded restart policy (plan §6.3). Never restart continuously: the third unexpected exit inside
 * the window opens the circuit for the rest of the session, and only an explicit health check or
 * rebuild may close it.
 */
export const ZVEC_HOST_RESTART_POLICY = {
  /** Unexpected exits tolerated inside `windowMs` before the circuit opens. */
  maxRestartsInWindow: 2,
  windowMs: 5 * 60_000,
  /** Delay before the second automatic restart, so a crash loop cannot spin. */
  restartDelayMs: 1_000
} as const;

/**
 * The host is optional infrastructure: a mutation that may have partially applied must not be
 * blindly replayed. Only reads and idempotent lifecycle calls are safe to retry after a host exit
 * (plan §6.4) — deterministic document ids make upsert idempotent, but `insert`/`update`/`delete`
 * are not proven so here and are left to reconciliation.
 */
export function isRetryableAfterHostExit(type: ZvecHostRequestType): boolean {
  switch (type) {
    case "hello":
    case "open":
    case "query":
    case "fetch":
    case "scan":
    case "count":
    case "stats":
    case "close":
    case "shutdown":
      return true;
    case "insert":
    case "upsert":
    case "update":
    case "delete":
    // A filtered delete is a mutation whose partial application cannot be detected from outside, so
    // it is never replayed automatically — reconciliation owns that decision.
    case "deleteByFilter":
      return false;
    default:
      return false;
  }
}

/** Type guard for the unsolicited event channel. */
export function isZvecHostEvent(message: unknown): message is ZvecHostEvent {
  if (typeof message !== "object" || message === null) return false;
  const m = message as { version?: unknown; type?: unknown };
  return m.version === ZVEC_HOST_PROTOCOL_VERSION && (m.type === "ready" || m.type === "fatal");
}

/** Type guard for a correlated response. */
export function isZvecHostResponse(message: unknown): message is ZvecHostResponse {
  if (typeof message !== "object" || message === null) return false;
  const m = message as { version?: unknown; id?: unknown; ok?: unknown };
  return m.version === ZVEC_HOST_PROTOCOL_VERSION && typeof m.id === "string" && typeof m.ok === "boolean";
}
