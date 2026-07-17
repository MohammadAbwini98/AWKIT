import { OracleBridgeCallError, type OracleBridgeErrorCategory } from "./OracleBridgeProtocol";
import { validateReadOnlySql } from "./OracleSqlPolicy";
import { enforceResultLimits, type JsonScalar, type WireBind } from "./OracleTypeConversion";
import type { OracleColumnMetadata } from "../data/DataSourceProfile";

/** Resolved connection descriptor + a redacted URL safe for logs. `descriptor` carries the password. */
export interface DescriptorResolution {
  descriptor: Record<string, unknown>;
  redactedUrl: string;
}

export interface OracleBridgeExecutor {
  call(
    op: "executeQuery",
    params: Record<string, unknown>,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<Record<string, unknown>>;
}

export interface OracleQueryServiceDeps {
  bridge: OracleBridgeExecutor;
  /** Resolve a connection profile id → descriptor (profile + secrets). Returns null if unknown. */
  resolveDescriptor: (connectionProfileId: string) => Promise<DescriptorResolution | null>;
  log?: (level: "info" | "warn" | "error", message: string) => void;
  /** Max concurrent Oracle operations (bounded backpressure). Default 4. */
  maxConcurrency?: number;
  /** Retries for retriable (transient connection) failures. Default 1. */
  maxTransientRetries?: number;
}

export interface OracleQueryRequest {
  connectionProfileId: string;
  sql: string;
  /** Already-resolved + typed binds (ValueResolver + OracleTypeConversion happen upstream). */
  binds: WireBind[];
  timeoutMs: number;
  maxRows: number;
  fetchSize: number;
  /** Additional TS-side result limits (columns/cell/serialized bytes). Unset falls back to a defensive default. */
  maxColumns?: number;
  maxCellBytes?: number;
  maxSerializedBytes?: number;
}

export interface OracleQueryResult {
  rows: Record<string, JsonScalar>[];
  columns: OracleColumnMetadata[];
  rowCount: number;
  truncated: boolean;
  executionMs: number;
  source: "runtime-query" | "snapshot";
}

/** Low-cardinality telemetry — NEVER SQL text or bind values as dimensions. */
export interface OracleQueryMetrics {
  queries: number;
  successes: number;
  failures: number;
  cancellations: number;
  timeouts: number;
  retries: number;
  totalLatencyMs: number;
  errorsByCategory: Record<string, number>;
}

/** These categories are safe to retry automatically (clearly transient connection problems). */
const RETRIABLE: ReadonlySet<OracleBridgeErrorCategory> = new Set(["NETWORK_UNREACHABLE"]);

/**
 * Defensive ceilings applied even when a caller doesn't specify one — Phase 11 requires limits on
 * columns/cell bytes/serialized bytes to hold at the TypeScript boundary regardless of caller intent,
 * not just when a node/Data Source happens to set them.
 */
const DEFAULT_MAX_COLUMNS = 200;
const DEFAULT_MAX_CELL_BYTES = 1_000_000;
const DEFAULT_MAX_SERIALIZED_BYTES = 25_000_000;

/**
 * THE single authority for running Oracle queries. Node executors and the Data Source resolver call
 * this — never the bridge directly. Responsibilities: read-only SQL validation, descriptor/secret
 * resolution, bridge dispatch, outer timeout, cancellation, transient-only retry, bounded
 * concurrency, error mapping, low-cardinality telemetry, and a normalized result.
 */
export class OracleQueryService {
  private readonly metrics: OracleQueryMetrics = {
    queries: 0,
    successes: 0,
    failures: 0,
    cancellations: 0,
    timeouts: 0,
    retries: 0,
    totalLatencyMs: 0,
    errorsByCategory: {}
  };
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly maxConcurrency: number;
  private readonly maxTransientRetries: number;

  constructor(private readonly deps: OracleQueryServiceDeps) {
    this.maxConcurrency = Math.max(1, deps.maxConcurrency ?? 4);
    this.maxTransientRetries = Math.max(0, deps.maxTransientRetries ?? 1);
  }

  getMetrics(): Readonly<OracleQueryMetrics> {
    return { ...this.metrics, errorsByCategory: { ...this.metrics.errorsByCategory } };
  }

  async execute(
    request: OracleQueryRequest,
    options: { signal?: AbortSignal; source?: "runtime-query" | "snapshot" } = {}
  ): Promise<OracleQueryResult> {
    const source = options.source ?? "runtime-query";
    // 1) Read-only gate BEFORE spawning/using the bridge (Java re-validates authoritatively).
    const policy = validateReadOnlySql(request.sql);
    if (!policy.allowed) {
      this.recordFailure("SQL_POLICY_VIOLATION");
      throw new OracleBridgeCallError("SQL_POLICY_VIOLATION", policy.reason ?? "SQL is not read-only.");
    }

    // 2) Resolve the connection descriptor (profile + secrets).
    const resolved = await this.deps.resolveDescriptor(request.connectionProfileId);
    if (!resolved) {
      this.recordFailure("INVALID_CONFIGURATION");
      throw new OracleBridgeCallError("INVALID_CONFIGURATION", `Unknown Oracle connection profile "${request.connectionProfileId}".`);
    }

    await this.acquire();
    try {
      return await this.runWithRetry(request, resolved, source, options.signal);
    } finally {
      this.release();
    }
  }

  private async runWithRetry(
    request: OracleQueryRequest,
    resolved: DescriptorResolution,
    source: "runtime-query" | "snapshot",
    signal?: AbortSignal
  ): Promise<OracleQueryResult> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.metrics.queries += 1;
      const started = Date.now();
      try {
        const params: Record<string, unknown> = {
          ...resolved.descriptor,
          sql: request.sql,
          binds: request.binds,
          maxRows: request.maxRows,
          fetchSize: request.fetchSize,
          timeoutMs: request.timeoutMs
        };
        this.deps.log?.("info", `[oracle] executeQuery → ${resolved.redactedUrl} (rows≤${request.maxRows})`);
        const raw = await this.deps.bridge.call("executeQuery", params, {
          timeoutMs: request.timeoutMs + 5_000,
          signal
        });
        const result = this.normalize(raw, request, source);
        this.metrics.successes += 1;
        this.metrics.totalLatencyMs += Date.now() - started;
        return result;
      } catch (err) {
        const category: OracleBridgeErrorCategory = err instanceof OracleBridgeCallError ? err.category : "UNKNOWN";
        if (category === "CANCELLED") this.metrics.cancellations += 1;
        if (category === "TIMEOUT") this.metrics.timeouts += 1;
        const retriable = err instanceof OracleBridgeCallError && (err.retriable || RETRIABLE.has(category));
        if (retriable && attempt < this.maxTransientRetries && category !== "CANCELLED") {
          attempt += 1;
          this.metrics.retries += 1;
          this.deps.log?.("warn", `[oracle] transient ${category} — retry ${attempt}/${this.maxTransientRetries}`);
          await new Promise((r) => setTimeout(r, 250 * attempt));
          continue;
        }
        this.recordFailure(category);
        throw err instanceof OracleBridgeCallError ? err : new OracleBridgeCallError("UNKNOWN", "Oracle query failed.");
      }
    }
  }

  private normalize(raw: Record<string, unknown>, request: OracleQueryRequest, source: "runtime-query" | "snapshot"): OracleQueryResult {
    const rows = Array.isArray(raw.rows) ? (raw.rows as Record<string, JsonScalar>[]) : [];
    const columns = Array.isArray(raw.columns) ? (raw.columns as OracleColumnMetadata[]) : [];
    const limit = enforceResultLimits(rows, columns, {
      maxRows: request.maxRows,
      maxColumns: request.maxColumns ?? DEFAULT_MAX_COLUMNS,
      maxCellBytes: request.maxCellBytes ?? DEFAULT_MAX_CELL_BYTES,
      maxSerializedBytes: request.maxSerializedBytes ?? DEFAULT_MAX_SERIALIZED_BYTES
    });
    if (!limit.ok) {
      throw new OracleBridgeCallError("RESULT_LIMIT_EXCEEDED", limit.reason ?? "Result exceeded limits.");
    }
    const boundedRows = rows.length > request.maxRows ? rows.slice(0, request.maxRows) : rows;
    const truncated = Boolean(raw.truncated) || limit.truncated;
    return {
      rows: boundedRows,
      columns,
      rowCount: typeof raw.rowCount === "number" ? Math.min(raw.rowCount, boundedRows.length) : boundedRows.length,
      truncated,
      executionMs: typeof raw.executionMs === "number" ? raw.executionMs : 0,
      source
    };
  }

  private recordFailure(category: string): void {
    this.metrics.failures += 1;
    this.metrics.errorsByCategory[category] = (this.metrics.errorsByCategory[category] ?? 0) + 1;
  }

  // ── Bounded concurrency limiter ────────────────────────────────────────────
  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}
