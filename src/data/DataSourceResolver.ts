import { createHash } from "node:crypto";
import type { ResolvedDataSource } from "../runner/InstanceExecutionContext";
import {
  isOracleDataSource,
  type DataSourceProfile,
  type JsonArrayDataSourceProfile,
  type OracleDataSourceProfile,
  type OracleDataSourceQuery
} from "./DataSourceProfile";

/**
 * THE authoritative Data Source resolver. Every Data Source type (JSON array, Oracle snapshot,
 * Oracle runtime) resolves to the same normalized {@link ResolvedDataSource} array-of-objects
 * contract, so Oracle sources work wherever JSON arrays already do (node mappings, workflow/flow
 * inputs, loops, previews).
 *
 * - **JSON array** → keeps the existing file/path contract (rows read lazily by the ValueResolver).
 * - **Oracle snapshot** → stored rows, no database connection required (offline).
 * - **Oracle runtime** → a single-flight, per-run-cached lazy loader that executes the query once and
 *   shares one in-flight promise across concurrent consumers (parallel branches / loops).
 *
 * Pure/framework-agnostic: the caller injects how JSON rows are read and how a runtime Oracle query
 * runs (the Phase-07 OracleQueryService). One resolver instance defines the cache scope — construct
 * one per workflow run and dispose it at run end so cache never crosses runs.
 */
export interface DataSourceResolverDeps {
  /** Read + select the array for a JSON-array data source (the existing execution.ipc logic). */
  readJsonRows(profile: JsonArrayDataSourceProfile): Promise<unknown[]>;
  /** Execute a runtime Oracle query and return normalized rows (Phase-07 OracleQueryService). */
  runOracleRuntimeQuery(profile: OracleDataSourceProfile): Promise<unknown[]>;
}

export class DataSourceResolver {
  private readonly runtimeCache = new Map<string, Promise<unknown[]>>();

  constructor(private readonly deps: DataSourceResolverDeps) {}

  resolve(profile: DataSourceProfile): ResolvedDataSource {
    if (isOracleDataSource(profile)) {
      return profile.mode === "snapshot" ? this.resolveSnapshot(profile) : this.resolveRuntime(profile);
    }
    const json = profile as JsonArrayDataSourceProfile;
    return {
      id: json.id,
      name: json.name,
      type: "jsonArray",
      file: json.file,
      rootArrayPath: json.path,
      // Rows are read lazily by the ValueResolver from file/path — unchanged legacy behavior.
      rows: []
    };
  }

  private resolveSnapshot(profile: OracleDataSourceProfile): ResolvedDataSource {
    const rows = profile.snapshot?.status === "ready" || profile.snapshot?.status === "empty"
      ? (profile.snapshot?.rows ?? [])
      : (profile.snapshot?.rows ?? []); // stale/error still returns the last good rows (offline safety)
    return {
      id: profile.id,
      name: profile.name,
      type: "oracle",
      oracleMode: "snapshot",
      file: "",
      rootArrayPath: "$",
      rows
    };
  }

  private resolveRuntime(profile: OracleDataSourceProfile): ResolvedDataSource {
    const loadRows = (): Promise<unknown[]> => {
      let inflight = this.runtimeCache.get(profile.id);
      if (!inflight) {
        inflight = this.deps.runOracleRuntimeQuery(profile).catch((err) => {
          // Do not cache a failed attempt — a retry should be allowed to re-execute.
          this.runtimeCache.delete(profile.id);
          throw err;
        });
        this.runtimeCache.set(profile.id, inflight);
      }
      return inflight;
    };
    return {
      id: profile.id,
      name: profile.name,
      type: "oracle",
      oracleMode: "runtime",
      file: "",
      rootArrayPath: "$",
      rows: [],
      loadRows
    };
  }

  /** Clear the per-run runtime cache (call at run end). */
  clearCache(): void {
    this.runtimeCache.clear();
  }
}

/** Stable hash of a query (SQL + binds + limits) — a query change marks a snapshot stale. */
export function computeQueryHash(query: OracleDataSourceQuery): string {
  const material = JSON.stringify({
    sql: (query.sql ?? "").replace(/\s+/g, " ").trim(),
    binds: (query.binds ?? []).map((b) => ({ p: b.position, n: b.name, t: b.jdbcType, s: b.source })),
    limits: { t: query.timeoutMs, m: query.maxRows, f: query.fetchSize }
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

/** Whether a snapshot is stale vs the current query + connection fingerprint. */
export function isSnapshotStale(profile: OracleDataSourceProfile, currentConnectionFingerprint: string): boolean {
  const snap = profile.snapshot;
  if (!snap) return true;
  if (snap.status === "error") return true;
  if (snap.queryHash !== computeQueryHash(profile.query)) return true;
  if (snap.connectionFingerprint !== currentConnectionFingerprint) return true;
  return false;
}
