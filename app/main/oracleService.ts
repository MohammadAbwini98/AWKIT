/**
 * Main-process Oracle wiring: the profile store (JSON), the DPAPI secret vault, the bridge process
 * manager, and the profile/query services. One lazily-constructed singleton per app run. Oracle is
 * OPTIONAL — if the bundled runtime/dev jar is absent, the services still construct and report the
 * feature as unavailable rather than breaking non-Oracle workflows.
 */
import { getAppMode, getResourcesRoot, getRuntimePaths } from "./appPaths";
import { getConfiguredPaths } from "./storagePaths";
import { getSecretStore } from "./secretStore";
import { JsonProfileStore } from "@src/storage/ProfileStore";
import type { OracleConnectionProfile } from "@src/oracle/OracleConnectionProfile";
import { OracleJdbcBridgeManager, type BridgeLaunchSpec } from "@src/oracle/OracleJdbcBridgeManager";
import { OracleProfileService, type OracleSecretVault } from "@src/oracle/OracleProfileService";
import { OracleQueryService, type OracleQueryResult } from "@src/oracle/OracleQueryService";
import { resolveOracleRuntime, type OracleRuntimeResolution } from "@src/oracle/OracleRuntimeResolver";
import type { OracleNodeExecuteRequest, OracleNodeRunner } from "@src/oracle/OracleNodeExecution";
import { OracleBridgeCallError } from "@src/oracle/OracleBridgeProtocol";
import { resolveDataSourceBinds } from "@src/oracle/OracleDataSourceBinds";
import type { JsonScalar } from "@src/oracle/OracleTypeConversion";
import { validateReadOnlySql } from "@src/oracle/OracleSqlPolicy";
import { computeQueryHash } from "@src/data/DataSourceResolver";
import { sanitizeProfileId } from "@src/storage/ProfileStore";
import {
  DEFAULT_ORACLE_QUERY_LIMITS,
  isOracleDataSource,
  type DataSourceProfile,
  type OracleBindDefinition,
  type OracleDataSourceMode,
  type OracleDataSourceProfile,
  type OracleDataSourceSnapshot
} from "@src/data/DataSourceProfile";

interface OracleServices {
  manager: OracleJdbcBridgeManager;
  profiles: OracleProfileService;
  query: OracleQueryService;
  resolution: OracleRuntimeResolution;
}

let singleton: OracleServices | null = null;

function createProfileStore(): JsonProfileStore<OracleConnectionProfile> {
  return new JsonProfileStore<OracleConnectionProfile>({
    folder: getRuntimePaths().folders["oracle-profiles"],
    createClone: (profile, nextId) => ({ ...profile, id: nextId, name: `${profile.name} Copy` })
  });
}

/** Adapt the DPAPI SecretStore to the by-name vault the Oracle services expect. */
function secretVault(): OracleSecretVault {
  const store = getSecretStore();
  return {
    set: (name, value) => store.set(name, value),
    get: (name) => store.get(name),
    has: (name) => store.has(name),
    delete: (name) => store.delete(name)
  };
}

function resolveLaunchSpec(): BridgeLaunchSpec {
  const resolution = resolveOracleRuntime({ resourcesRoot: getResourcesRoot(), appMode: getAppMode() });
  if (!resolution.available || !resolution.launchSpec) {
    throw new Error(resolution.reason ?? "Oracle bridge runtime is unavailable.");
  }
  // The resolver bakes the fail-closed env into the launch spec: `AWKIT_ORACLE_REQUIRE_REAL` in
  // packaged production (never mock), or `AWKIT_ORACLE_BRIDGE_MOCK` only in dev without a driver.
  return resolution.launchSpec;
}

export function getOracleServices(): OracleServices {
  if (singleton) return singleton;
  const resolution = resolveOracleRuntime({ resourcesRoot: getResourcesRoot(), appMode: getAppMode() });
  const manager = new OracleJdbcBridgeManager({
    resolveLaunchSpec,
    // Fail closed in packaged production: reject a mock / driver-unavailable handshake at startup so
    // Oracle live queries can never run against synthetic results.
    requireRealDriver: resolution.requireRealDriver,
    logger: (level, message) => {
      if (level === "error") console.error(message);
      else if (level === "warn") console.warn(message);
    },
    onStderr: (line) => console.warn(`[oracle-bridge:stderr] ${line}`)
  });
  const profiles = new OracleProfileService(createProfileStore(), secretVault(), manager, (level, message) => {
    if (level === "warn") console.warn(message);
  });
  const query = new OracleQueryService({
    bridge: manager,
    resolveDescriptor: (id) => profiles.resolveDescriptorForId(id),
    log: (level, message) => {
      if (level === "warn") console.warn(message);
    }
  });
  singleton = { manager, profiles, query, resolution };
  return singleton;
}

/** Read a Data Source profile from the shared data-sources folder (any type). */
function dataSourceStore(): JsonProfileStore<DataSourceProfile> {
  return new JsonProfileStore<DataSourceProfile>({ folder: getConfiguredPaths().dataSources });
}

/** Build a runtime OracleQueryResult from a stored snapshot (offline — no database). */
function resultFromSnapshot(ds: OracleDataSourceProfile): OracleQueryResult {
  const snap = ds.snapshot;
  return {
    rows: snap?.rows ?? [],
    columns: (snap?.columns ?? []).map((c) => ({ name: c.name, jdbcType: c.jdbcType })),
    rowCount: snap?.rowCount ?? snap?.rows?.length ?? 0,
    truncated: snap?.truncated ?? false,
    executionMs: 0,
    source: "snapshot"
  };
}

/** A secret-safe one-line summary of a query failure (category only — never SQL text or values). */
function snapshotErrorSummary(err: unknown): string {
  if (err instanceof OracleBridgeCallError) return `Query failed (${err.category}).`;
  return "Query failed.";
}

/**
 * Execute an Oracle **Data Source**'s own query (runtime mode) and return normalized rows. Binds are
 * resolved at data-source resolution time (static / env / workflowInput only — see
 * {@link resolveDataSourceBinds}). Used by the Phase-10 `DataSourceResolver` runtime loader.
 */
export async function runOracleDataSourceQuery(
  profile: OracleDataSourceProfile,
  signal?: AbortSignal
): Promise<Record<string, JsonScalar>[]> {
  if (!profile.connectionProfileId) {
    throw new OracleBridgeCallError("INVALID_CONFIGURATION", `Oracle Data Source "${profile.name}" has no connection profile.`);
  }
  if (!profile.query?.sql?.trim()) {
    throw new OracleBridgeCallError("INVALID_CONFIGURATION", `Oracle Data Source "${profile.name}" has no SQL query.`);
  }
  const { query } = getOracleServices();
  const binds = resolveDataSourceBinds(profile.query.binds, { env: process.env });
  const result = await query.execute(
    {
      connectionProfileId: profile.connectionProfileId,
      sql: profile.query.sql,
      binds,
      timeoutMs: profile.query.timeoutMs,
      maxRows: profile.query.maxRows,
      fetchSize: profile.query.fetchSize
    },
    { signal, source: "runtime-query" }
  );
  return result.rows;
}

/**
 * Phase 06 — execute an Oracle Data Source's query once, normalize to an array of JSON objects, and
 * atomically persist the result as the profile's offline snapshot. On failure the last good rows are
 * preserved (offline safety) and the snapshot is marked `error` with a secret-safe summary. Returns
 * the updated profile. Never throws for a query failure — the failure is recorded in the snapshot.
 */
export async function refreshOracleDataSourceSnapshot(id: string, signal?: AbortSignal): Promise<OracleDataSourceProfile> {
  const store = dataSourceStore();
  const ds = await store.get(id);
  if (!ds || !isOracleDataSource(ds)) {
    throw new OracleBridgeCallError("INVALID_CONFIGURATION", `Oracle Data Source "${id}" was not found.`);
  }

  const { profiles, query } = getOracleServices();
  const connectionFingerprint = (await profiles.connectionFingerprintForId(ds.connectionProfileId)) ?? "";
  const queryHash = computeQueryHash(ds.query);
  const capturedAt = new Date().toISOString();

  let snapshot: OracleDataSourceSnapshot;
  try {
    const binds = resolveDataSourceBinds(ds.query.binds, { env: process.env });
    const result = await query.execute(
      {
        connectionProfileId: ds.connectionProfileId,
        sql: ds.query.sql,
        binds,
        timeoutMs: ds.query.timeoutMs,
        maxRows: ds.query.maxRows,
        fetchSize: ds.query.fetchSize
      },
      { signal, source: "runtime-query" }
    );
    snapshot = {
      rows: result.rows,
      columns: result.columns,
      rowCount: result.rowCount,
      capturedAt,
      queryHash,
      connectionFingerprint,
      status: result.rowCount === 0 ? "empty" : "ready",
      truncated: result.truncated
    };
  } catch (err) {
    // Preserve the last good rows for offline safety; record a secret-safe error summary.
    snapshot = {
      rows: ds.snapshot?.rows ?? [],
      columns: ds.snapshot?.columns ?? [],
      rowCount: ds.snapshot?.rowCount ?? 0,
      capturedAt,
      queryHash,
      connectionFingerprint,
      status: "error",
      truncated: ds.snapshot?.truncated,
      error: snapshotErrorSummary(err)
    };
  }

  const updated: OracleDataSourceProfile = { ...ds, snapshot, updatedAt: capturedAt };
  await store.update(id, updated);
  return updated;
}

/** Input for creating/updating an Oracle Data Source (Phase 05 UI + Phase 04 model). */
export interface OracleDataSourceInput {
  id?: string;
  name: string;
  description?: string;
  connectionProfileId: string;
  mode: OracleDataSourceMode;
  query: {
    sql: string;
    binds?: OracleBindDefinition[];
    timeoutMs?: number;
    maxRows?: number;
    fetchSize?: number;
  };
  runtimePolicy?: { cacheScope: "workflow-run" | "flow-run" | "none" };
}

/** List all Oracle-type Data Source profiles (the shared store also holds jsonArray sources). */
export async function listOracleDataSources(): Promise<OracleDataSourceProfile[]> {
  const all = await dataSourceStore().list();
  return all.filter(isOracleDataSource);
}

/** Get one Oracle Data Source profile, or null if the id is unknown or not an Oracle source. */
export async function getOracleDataSource(id: string): Promise<OracleDataSourceProfile | null> {
  const ds = await dataSourceStore().get(id);
  return ds && isOracleDataSource(ds) ? ds : null;
}

/** Delete an Oracle Data Source profile (no-op if absent). */
export async function deleteOracleDataSource(id: string): Promise<void> {
  await dataSourceStore().delete(id);
}

/**
 * Create or update an Oracle Data Source profile. Validates the query is read-only up front (the
 * bridge re-validates), fills query-limit defaults, and preserves any existing offline snapshot
 * across edits. Credentials never live here — only a `connectionProfileId` reference.
 */
export async function saveOracleDataSource(input: OracleDataSourceInput): Promise<OracleDataSourceProfile> {
  const name = input.name?.trim();
  if (!name) throw new OracleBridgeCallError("INVALID_CONFIGURATION", "A Data Source name is required.");
  if (!input.connectionProfileId) throw new OracleBridgeCallError("INVALID_CONFIGURATION", "An Oracle connection profile is required.");
  const policy = validateReadOnlySql(input.query?.sql);
  if (!policy.allowed) throw new OracleBridgeCallError("SQL_POLICY_VIOLATION", policy.reason ?? "Only read-only SELECT queries are allowed.");

  const store = dataSourceStore();
  const existing = input.id ? await store.get(input.id) : null;
  const existingOracle = existing && isOracleDataSource(existing) ? existing : undefined;
  const now = new Date().toISOString();
  const profile: OracleDataSourceProfile = {
    id: sanitizeProfileId(input.id ?? name),
    name,
    type: "oracle",
    description: input.description,
    connectionProfileId: input.connectionProfileId,
    mode: input.mode,
    query: {
      sql: input.query.sql,
      binds: input.query.binds ?? [],
      timeoutMs: input.query.timeoutMs ?? DEFAULT_ORACLE_QUERY_LIMITS.timeoutMs,
      maxRows: input.query.maxRows ?? DEFAULT_ORACLE_QUERY_LIMITS.maxRows,
      fetchSize: input.query.fetchSize ?? DEFAULT_ORACLE_QUERY_LIMITS.fetchSize
    },
    runtimePolicy: input.runtimePolicy,
    // Keep any captured snapshot across edits; the resolver marks it stale if the query changed.
    snapshot: existingOracle?.snapshot,
    createdAt: existingOracle?.createdAt ?? now,
    updatedAt: now
  };
  const saved = existingOracle ? await store.update(profile.id, profile) : await store.create(profile);
  return saved as OracleDataSourceProfile;
}

/**
 * The Oracle node runner (main process): resolves the node's connection source (profile or Data
 * Source, including offline snapshots) and executes through the single OracleQueryService authority.
 */
export function getOracleNodeRunner(): OracleNodeRunner {
  return async (request: OracleNodeExecuteRequest, options) => {
    const { query } = getOracleServices();
    const cfg = request.config;

    if (cfg.connectionSource === "profile") {
      if (!cfg.connectionProfileId) throw new OracleBridgeCallError("INVALID_CONFIGURATION", "No Oracle connection profile selected.");
      if (!cfg.sql?.trim()) throw new OracleBridgeCallError("INVALID_CONFIGURATION", "A SQL query is required.");
      return query.execute(
        {
          connectionProfileId: cfg.connectionProfileId,
          sql: cfg.sql,
          binds: request.binds,
          timeoutMs: cfg.timeoutMs ?? 30_000,
          maxRows: cfg.maxRows ?? 10_000,
          fetchSize: cfg.fetchSize ?? 200
        },
        { signal: options.signal, source: "runtime-query" }
      );
    }

    // Data Source connection source.
    if (!cfg.dataSourceId) throw new OracleBridgeCallError("INVALID_CONFIGURATION", "No Oracle Data Source selected.");
    const ds = await dataSourceStore().get(cfg.dataSourceId);
    if (!ds || !isOracleDataSource(ds)) {
      throw new OracleBridgeCallError("INVALID_CONFIGURATION", `Oracle Data Source "${cfg.dataSourceId}" was not found.`);
    }
    if (ds.mode === "snapshot") {
      return resultFromSnapshot(ds);
    }
    return query.execute(
      {
        connectionProfileId: ds.connectionProfileId,
        sql: cfg.sql?.trim() || ds.query.sql,
        binds: request.binds,
        timeoutMs: cfg.timeoutMs ?? ds.query.timeoutMs,
        maxRows: cfg.maxRows ?? ds.query.maxRows,
        fetchSize: cfg.fetchSize ?? ds.query.fetchSize
      },
      { signal: options.signal, source: "runtime-query" }
    );
  };
}

/** Whether the Oracle feature can run in this build (bundled runtime or dev jar present). */
export function oracleAvailability(): { available: boolean; source: string; reason?: string; driverExpected: boolean } {
  const resolution = resolveOracleRuntime({ resourcesRoot: getResourcesRoot(), appMode: getAppMode() });
  return {
    available: resolution.available,
    source: resolution.source,
    reason: resolution.reason,
    driverExpected: resolution.driverExpected
  };
}

/** Graceful shutdown on app quit — guarantees no orphaned Java process. */
export async function disposeOracleServices(): Promise<void> {
  if (!singleton) return;
  await singleton.manager.dispose().catch(() => undefined);
  singleton = null;
}
