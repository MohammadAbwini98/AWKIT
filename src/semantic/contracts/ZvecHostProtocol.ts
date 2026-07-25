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

export const ZVEC_HOST_PROTOCOL_VERSION = 1;

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
 * Structured query. The renderer never supplies a raw vendor filter expression — the service builds
 * this object, and the host translates it.
 */
export interface ZvecSafeQuery {
  fieldName: string;
  fts?: { queryString?: string; matchString?: string };
  vector?: number[];
  topK?: number;
}

export type ZvecHostRequest =
  | { version: 1; id: string; type: "hello"; expected?: ZvecHostCompatibility }
  | { version: 1; id: string; type: "open"; generation: string; path: string; schema: ZvecSafeSchema }
  | { version: 1; id: string; type: "insert"; collectionId: string; docs: ZvecSafeDocument[] }
  | { version: 1; id: string; type: "upsert"; collectionId: string; docs: ZvecSafeDocument[] }
  | { version: 1; id: string; type: "update"; collectionId: string; docId: string; fields: Record<string, unknown> }
  | { version: 1; id: string; type: "delete"; collectionId: string; ids: string[] }
  | { version: 1; id: string; type: "fetch"; collectionId: string; ids: string[] }
  | { version: 1; id: string; type: "query"; collectionId: string; query: ZvecSafeQuery }
  | { version: 1; id: string; type: "stats"; collectionId: string }
  | { version: 1; id: string; type: "close"; collectionId: string }
  | { version: 1; id: string; type: "shutdown" };

export type ZvecHostRequestType = ZvecHostRequest["type"];

/** What the manager asserts the host must be, checked during the `hello` handshake. */
export interface ZvecHostCompatibility {
  protocolVersion: number;
  platform: string;
  arch: string;
}

// ─────────────────────────────── responses ───────────────────────────────

export type ZvecHostResponse =
  | { version: 1; id: string; ok: true; value?: unknown }
  | { version: 1; id: string; ok: false; reason: ZvecHostReasonCode; retryable: boolean };

/** Unsolicited host → manager messages. `ready` is emitted once, immediately after startup. */
export type ZvecHostEvent =
  | { version: 1; type: "ready"; pid: number }
  | { version: 1; type: "fatal"; reason: ZvecHostReasonCode };

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
    case "stats":
    case "close":
    case "shutdown":
      return true;
    case "insert":
    case "upsert":
    case "update":
    case "delete":
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
