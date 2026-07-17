/**
 * Main-process Oracle wiring: the profile store (JSON), the DPAPI secret vault, the bridge process
 * manager, and the profile/query services. One lazily-constructed singleton per app run. Oracle is
 * OPTIONAL — if the bundled runtime/dev jar is absent, the services still construct and report the
 * feature as unavailable rather than breaking non-Oracle workflows.
 */
import { join } from "node:path";
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
import { ORACLE_BRIDGE_PROTOCOL_VERSION, OracleBridgeCallError, type OracleBridgeOp } from "@src/oracle/OracleBridgeProtocol";
import { OracleDriverBundleStore, type DriverProbeResult } from "@src/oracle/OracleDriverBundleStore";
import {
  compatibilityLabelFor,
  driverBundleCompatibilityKey,
  type OracleDriverBundle,
  type OracleDriverBundleView
} from "@src/oracle/OracleDriverBundle";
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
  profiles: OracleProfileService;
  query: OracleQueryService;
  resolution: OracleRuntimeResolution;
}

let singleton: OracleServices | null = null;

/**
 * Phase 07 — one Java bridge process per driver-bundle **compatibility key**, so different Oracle
 * driver versions never share a classpath. Managers are created lazily and cached here; all are
 * disposed on app quit (teardown invariant: no orphan Java).
 */
const bridgeRegistry = new Map<string, OracleJdbcBridgeManager>();
const isWin = process.platform === "win32";
const CLASSPATH_SEP = isWin ? ";" : ":";
const BRIDGE_MAIN_CLASS = "com.specterstudio.oracle.bridge.Main";

function createProfileStore(): JsonProfileStore<OracleConnectionProfile> {
  return new JsonProfileStore<OracleConnectionProfile>({
    folder: getRuntimePaths().folders["oracle-profiles"],
    createClone: (profile, nextId) => ({ ...profile, id: nextId, name: `${profile.name} Copy` })
  });
}

/** The managed Oracle JDBC driver-bundle store (with a real isolated-bridge probe injected). */
function driverBundleStore(): OracleDriverBundleStore {
  return new OracleDriverBundleStore({
    folder: getRuntimePaths().folders["oracle-drivers"],
    probe: probeDriverClasspath
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

/** Absolute classpath jars for a managed bundle (driver + optional UCP + companions). */
function bundleClasspathJars(bundle: OracleDriverBundle): string[] {
  return [
    join(bundle.managedDirectory, bundle.jdbcJar),
    ...(bundle.ucpJar ? [join(bundle.managedDirectory, bundle.ucpJar)] : []),
    ...bundle.companionJars.map((c) => join(bundle.managedDirectory, c))
  ];
}

/** Build a bridge launch spec, adding a managed bundle's jars to the classpath (a real driver). */
function bundleLaunchSpec(base: BridgeLaunchSpec, bundle: OracleDriverBundle | undefined): BridgeLaunchSpec {
  if (!bundle) return base; // vendored driver (packaged) or dev mock — resolver already baked the env
  const env: Record<string, string | undefined> = { ...base.env };
  // A managed bundle IS a real driver — never force the mock, and require a real load (fail closed).
  delete env.AWKIT_ORACLE_BRIDGE_MOCK;
  env.AWKIT_ORACLE_REQUIRE_REAL = "1";
  return {
    ...base,
    classpath: [base.jarPath, ...bundleClasspathJars(bundle)].join(CLASSPATH_SEP),
    mainClass: BRIDGE_MAIN_CLASS,
    env
  };
}

/**
 * Resolve (creating + caching lazily) the isolated Java bridge for a given driver bundle id. A tampered
 * or corrupted bundle fails closed here — the bridge is never launched. `undefined` ⇒ the store's
 * default bundle, else the resolver's base spec (vendored driver in packaged production, or dev mock).
 */
function getManagerForBundle(bundleId: string | undefined): OracleJdbcBridgeManager {
  const resolution = resolveOracleRuntime({ resourcesRoot: getResourcesRoot(), appMode: getAppMode() });
  if (!resolution.available || !resolution.launchSpec) {
    throw new OracleBridgeCallError("DRIVER_UNAVAILABLE", resolution.reason ?? "Oracle bridge runtime is unavailable.");
  }
  const store = driverBundleStore();
  const effectiveId = bundleId ?? store.getDefaultId();
  const bundle = effectiveId ? store.get(effectiveId) ?? undefined : undefined;

  const key = driverBundleCompatibilityKey({
    driverBundleId: bundle?.id ?? "__base__",
    javaIdentity: resolution.launchSpec.javaPath,
    protocolVersion: ORACLE_BRIDGE_PROTOCOL_VERSION
  });
  const existing = bridgeRegistry.get(key);
  if (existing) return existing;

  // Fail closed on a tampered/corrupt bundle — validate integrity before the first launch.
  if (bundle) {
    const status = store.revalidateChecksums(bundle.id);
    if (status === "checksum-failed" || status === "missing") {
      throw new OracleBridgeCallError(
        "DRIVER_UNAVAILABLE",
        `The Oracle driver bundle "${bundle.name}" failed integrity validation (${status}). It will not be loaded.`
      );
    }
  }

  const spec = bundleLaunchSpec(resolution.launchSpec, bundle);
  const manager = new OracleJdbcBridgeManager({
    resolveLaunchSpec: () => spec,
    // Fail closed: with a real bundle (or in packaged production) reject a mock/unavailable handshake.
    requireRealDriver: resolution.requireRealDriver || !!bundle,
    logger: (level, message) => {
      if (level === "error") console.error(message);
      else if (level === "warn") console.warn(message);
    },
    onStderr: (line) => console.warn(`[oracle-bridge:stderr] ${line}`)
  });
  bridgeRegistry.set(key, manager);
  return manager;
}

/**
 * A routing facade over the per-bundle registry: `.call()` reads the profile's `driverBundleId` from
 * the descriptor and dispatches to that bundle's isolated bridge. Existing services (profile/query)
 * keep calling `bridge.call(...)` unchanged.
 */
const routingBridge = {
  call: (op: OracleBridgeOp, params: Record<string, unknown>, options?: { timeoutMs?: number; signal?: AbortSignal }) => {
    const bundleId = typeof params.driverBundleId === "string" && params.driverBundleId ? params.driverBundleId : undefined;
    return getManagerForBundle(bundleId).call(op, params, options);
  }
};

/**
 * Load-test a candidate classpath in a temporary isolated bridge (Phase 06 import validation). Uses
 * the reflective `driverProbe` op so it works even when the real query executors were not compiled
 * into this bridge build. Returns `probed:false` when the bridge itself cannot launch (couldn't test).
 */
async function probeDriverClasspath(classpathJars: string[]): Promise<DriverProbeResult> {
  const resolution = resolveOracleRuntime({ resourcesRoot: getResourcesRoot(), appMode: getAppMode() });
  if (!resolution.available || !resolution.launchSpec) {
    return { probed: false, driverAvailable: false, reason: "The Oracle bridge runtime is unavailable in this build." };
  }
  const base = resolution.launchSpec;
  const env: Record<string, string | undefined> = { ...base.env };
  delete env.AWKIT_ORACLE_BRIDGE_MOCK; // probe the REAL driver on the candidate classpath, never the mock
  const manager = new OracleJdbcBridgeManager({
    resolveLaunchSpec: () => ({
      ...base,
      classpath: [base.jarPath, ...classpathJars].join(CLASSPATH_SEP),
      mainClass: BRIDGE_MAIN_CLASS,
      env
    })
    // No requireRealDriver: we want the handshake to succeed so we can inspect the probe result.
  });
  try {
    const probe = await manager.call("driverProbe", {}, { timeoutMs: 20_000 });
    return {
      probed: true,
      driverAvailable: probe.driverAvailable === true,
      driverVersion: typeof probe.driverVersion === "string" ? probe.driverVersion : undefined,
      ucpVersion: typeof probe.ucpVersion === "string" ? probe.ucpVersion : undefined,
      javaVersion: typeof probe.javaVersion === "string" ? probe.javaVersion : undefined
    };
  } catch (err) {
    return { probed: false, driverAvailable: false, reason: err instanceof OracleBridgeCallError ? `Bridge error (${err.category}).` : "Bridge could not run the driver probe." };
  } finally {
    await manager.dispose().catch(() => undefined);
  }
}

export function getOracleServices(): OracleServices {
  if (singleton) return singleton;
  const resolution = resolveOracleRuntime({ resourcesRoot: getResourcesRoot(), appMode: getAppMode() });
  const profiles = new OracleProfileService(createProfileStore(), secretVault(), routingBridge, (level, message) => {
    if (level === "warn") console.warn(message);
  });
  const query = new OracleQueryService({
    bridge: routingBridge,
    resolveDescriptor: (id) => profiles.resolveDescriptorForId(id),
    log: (level, message) => {
      if (level === "warn") console.warn(message);
    }
  });
  singleton = { profiles, query, resolution };
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

/** Graceful shutdown on app quit — disposes every per-bundle bridge (no orphaned Java process). */
export async function disposeOracleServices(): Promise<void> {
  const managers = [...bridgeRegistry.values()];
  bridgeRegistry.clear();
  await Promise.all(managers.map((m) => m.dispose().catch(() => undefined)));
  singleton = null;
}

// ── Managed Oracle JDBC driver bundles (Phases 05–07) ─────────────────────────────────────────────

/** Count how many connection profiles reference a bundle (blocks deletion while > 0). */
async function driverBundleUsageCount(bundleId: string): Promise<number> {
  const profiles = await createProfileStore().list();
  return profiles.filter((p) => p.driverBundleId === bundleId).length;
}

/** Renderer-safe projection of a bundle (adds default flag, usage count, pooling support). */
async function toDriverBundleView(bundle: OracleDriverBundle, defaultId: string | undefined): Promise<OracleDriverBundleView> {
  return {
    ...bundle,
    isDefault: bundle.id === defaultId,
    usageCount: await driverBundleUsageCount(bundle.id),
    supportsPooling: !!bundle.ucpJar,
    // The bridge JDK major is not known synchronously here; the label degrades gracefully without it.
    compatibilityLabel: compatibilityLabelFor(bundle)
  };
}

export async function listOracleDriverBundles(): Promise<OracleDriverBundleView[]> {
  const store = driverBundleStore();
  const defaultId = store.getDefaultId();
  return Promise.all(store.list().map((b) => toDriverBundleView(b, defaultId)));
}

export async function getOracleDriverBundle(id: string): Promise<OracleDriverBundleView | null> {
  const store = driverBundleStore();
  const bundle = store.get(id);
  return bundle ? toDriverBundleView(bundle, store.getDefaultId()) : null;
}

/** Import a bundle from user-selected jar files (validated + copied + load-tested). */
export async function importOracleDriverBundle(input: { name: string; sourceFiles: string[] }): Promise<OracleDriverBundleView> {
  const store = driverBundleStore();
  const bundle = await store.import(input);
  // First imported bundle becomes the default automatically.
  if (!store.getDefaultId()) store.setDefault(bundle.id);
  return toDriverBundleView(bundle, store.getDefaultId());
}

/** Re-run checksum + isolated-bridge load validation for a bundle. */
export async function validateOracleDriverBundle(id: string): Promise<OracleDriverBundleView> {
  const store = driverBundleStore();
  const bundle = await store.validate(id);
  return toDriverBundleView(bundle, store.getDefaultId());
}

export async function setDefaultOracleDriverBundle(id: string): Promise<void> {
  driverBundleStore().setDefault(id);
}

/** Delete a bundle. Refuses while any connection profile still references it. */
export async function removeOracleDriverBundle(id: string): Promise<void> {
  const usage = await driverBundleUsageCount(id);
  if (usage > 0) {
    throw new OracleBridgeCallError(
      "INVALID_CONFIGURATION",
      `This driver bundle is used by ${usage} connection profile${usage === 1 ? "" : "s"}. Remap them to another bundle before deleting it.`
    );
  }
  driverBundleStore().remove(id);
}

export async function getOracleDriverBundleUsage(id: string): Promise<number> {
  return driverBundleUsageCount(id);
}

/** "Test bridge loading" — launch an isolated bridge with the bundle's jars and report the probe. */
export async function testOracleDriverBundleLoad(id: string): Promise<DriverProbeResult> {
  const bundle = driverBundleStore().get(id);
  if (!bundle) throw new OracleBridgeCallError("INVALID_CONFIGURATION", `Driver bundle "${id}" was not found.`);
  const checksum = driverBundleStore().revalidateChecksums(id);
  if (checksum === "checksum-failed" || checksum === "missing") {
    return { probed: false, driverAvailable: false, reason: `Bundle integrity check failed (${checksum}).` };
  }
  return probeDriverClasspath(bundleClasspathJars(bundle));
}
