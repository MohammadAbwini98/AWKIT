/**
 * Data Source profiles. AWKIT began with a single JSON-array type; Oracle adds a second type. The
 * two form a discriminated union on `type`, so existing `jsonArray` profiles deserialize and behave
 * EXACTLY as before (backward compatible), while consumers can branch on the discriminator.
 *
 * All Data Source types resolve to the same normalized array-of-objects runtime contract via
 * `DataSourceResolver` (see `src/data/DataSourceResolver.ts`).
 */

export interface JsonArrayDataSourceProfile {
  id: string;
  name: string;
  type: "jsonArray";
  file: string;
  path: string;
  createdAt?: string;
  updatedAt?: string;
  rowCount?: number;
  sampleRow?: unknown;
}

/** JDBC bind definition for an Oracle Data Source / node query. */
export interface OracleBindDefinition {
  /** 1-based ordinal position OR a name for named binds (`:name`). */
  position?: number;
  name?: string;
  /** JDBC type used to convert the resolved value before binding. */
  jdbcType: "STRING" | "NUMBER" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "DATE" | "TIMESTAMP" | "NULL";
  /** Static value, or a dynamic AWKIT ValueSource (serialized) resolved at run time. */
  source: OracleBindSource;
  required?: boolean;
  /** Fallback used when a dynamic source resolves to empty and `required` is false. */
  defaultValue?: string;
}

/** Where a bind's value comes from. Mirrors AWKIT's existing dynamic-value conventions. */
export interface OracleBindSource {
  kind: "static" | "workflowInput" | "flowInput" | "previousOutput" | "currentRow" | "env";
  /** Literal for `static`; key/path/expression for the dynamic kinds. */
  value?: string;
  key?: string;
  path?: string;
}

export interface OracleColumnMetadata {
  name: string;
  jdbcType: string;
  /** Deterministic JSON kind the column was converted to. */
  jsonType?: "string" | "number" | "boolean" | "null" | "mixed";
}

export type OracleDataSourceMode = "runtime" | "snapshot";
export type OracleSnapshotStatus = "ready" | "stale" | "error" | "empty";

/** Normalized JSON scalar — the only value kind a snapshot row stores (see snapshot contract). */
export type OracleJsonScalar = string | number | boolean | null;

export interface OracleDataSourceQuery {
  sql: string;
  binds: OracleBindDefinition[];
  timeoutMs: number;
  maxRows: number;
  fetchSize: number;
}

export interface OracleDataSourceSnapshot {
  rows: Record<string, OracleJsonScalar>[];
  columns: OracleColumnMetadata[];
  rowCount: number;
  capturedAt: string;
  /** Hash of the query at capture time — a query change marks the snapshot stale. */
  queryHash: string;
  /** Connection fingerprint at capture time — a profile change marks the snapshot stale. */
  connectionFingerprint: string;
  status: OracleSnapshotStatus;
  truncated?: boolean;
  /** Safe error summary when `status === "error"`. */
  error?: string;
}

export interface OracleDataSourceProfile {
  id: string;
  name: string;
  type: "oracle";
  description?: string;
  connectionProfileId: string;
  mode: OracleDataSourceMode;
  query: OracleDataSourceQuery;
  runtimePolicy?: {
    cacheScope: "workflow-run" | "flow-run" | "none";
  };
  snapshot?: OracleDataSourceSnapshot;
  createdAt?: string;
  updatedAt?: string;
}

export type DataSourceProfile = JsonArrayDataSourceProfile | OracleDataSourceProfile;

export function isJsonArrayDataSource(p: DataSourceProfile): p is JsonArrayDataSourceProfile {
  // Legacy profiles may omit `type`; treat a missing discriminator as the original jsonArray type.
  return (p as { type?: string }).type === "jsonArray" || (p as { type?: string }).type === undefined;
}

export function isOracleDataSource(p: DataSourceProfile): p is OracleDataSourceProfile {
  return (p as { type?: string }).type === "oracle";
}

export const DEFAULT_ORACLE_QUERY_LIMITS = {
  timeoutMs: 30_000,
  maxRows: 10_000,
  fetchSize: 200
} as const;
