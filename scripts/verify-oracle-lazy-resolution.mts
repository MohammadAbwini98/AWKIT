/**
 * Lazy Oracle Data Source semantics + fail-closed product behavior — driven by the REAL Java bridge.
 *
 * Phase 07 requires "real bridge/query counters", so this does NOT stub the query function: it builds
 * and spawns the actual Java bridge process, wires `DataSourceResolver` → `OracleQueryService` →
 * `OracleJdbcBridgeManager`, and counts the **real `executeQuery` RPCs dispatched to the Java child**.
 * (The bridge runs its database-free mock EXECUTOR — that is the external gate — but the process,
 * protocol, dispatch, SQL gate, and RPC accounting are all real.)
 *
 * Also covers Phase 04's "Required Product Behavior": when the Oracle runtime is unavailable, JSON and
 * Oracle Snapshot Data Sources keep working and Runtime sources fail safely instead of crashing.
 *
 * Run: `npm run verify:oracle-lazy-resolution`.
 */
import { buildOracleBridge } from "./build-oracle-bridge.mjs";
import { OracleJdbcBridgeManager, type BridgeLaunchSpec } from "../src/oracle/OracleJdbcBridgeManager";
import { OracleQueryService, type DescriptorResolution } from "../src/oracle/OracleQueryService";
import { OracleBridgeCallError } from "../src/oracle/OracleBridgeProtocol";
import { DataSourceResolver } from "../src/data/DataSourceResolver";
import type { DataSourceProfile, OracleDataSourceProfile, JsonArrayDataSourceProfile } from "../src/data/DataSourceProfile";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

const BASE = { createdAt: "2026-07-17T00:00:00Z", updatedAt: "2026-07-17T00:00:00Z" };

function runtimeProfile(id: string): OracleDataSourceProfile {
  return {
    ...BASE,
    id,
    name: `Runtime ${id}`,
    type: "oracle",
    connectionProfileId: "prod",
    mode: "runtime",
    query: { sql: "SELECT id FROM orders", binds: [], timeoutMs: 30_000, maxRows: 100, fetchSize: 200 }
  };
}

function snapshotProfile(id: string): OracleDataSourceProfile {
  return {
    ...BASE,
    id,
    name: `Snapshot ${id}`,
    type: "oracle",
    connectionProfileId: "prod",
    mode: "snapshot",
    query: { sql: "SELECT id FROM orders", binds: [], timeoutMs: 30_000, maxRows: 100, fetchSize: 200 },
    snapshot: {
      rows: [{ ID: 1 }, { ID: 2 }],
      columns: [{ name: "ID", jdbcType: "NUMBER" }],
      rowCount: 2,
      capturedAt: BASE.createdAt,
      queryHash: "h",
      connectionFingerprint: "fp",
      status: "ready",
      truncated: false
    }
  };
}

function jsonProfile(id: string): JsonArrayDataSourceProfile {
  return { ...BASE, id, name: `Json ${id}`, type: "jsonArray", file: "C:/data/rows.json", path: "$" } as JsonArrayDataSourceProfile;
}

async function main(): Promise<void> {
  console.log("Building + spawning the REAL Java bridge…");
  const build = buildOracleBridge({ quiet: true });
  const spec: BridgeLaunchSpec = { javaPath: build.jdk.java, jarPath: build.jarPath, env: { AWKIT_ORACLE_BRIDGE_MOCK: "1" } };
  const manager = new OracleJdbcBridgeManager({ resolveLaunchSpec: () => spec, handshakeTimeoutMs: 20_000 });

  // REAL counter: count executeQuery RPCs actually dispatched to the Java child process.
  let executeQueryRpcs = 0;
  const originalCall = manager.call.bind(manager);
  (manager as unknown as { call: typeof manager.call }).call = ((op, params, options) => {
    if (op === "executeQuery") executeQueryRpcs += 1;
    return originalCall(op, params, options);
  }) as typeof manager.call;

  const descriptors: Record<string, DescriptorResolution> = {
    prod: {
      descriptor: { url: "jdbc:oracle:thin:@//db:1521/ORCLPDB1", username: "reader", password: "pw", poolKey: "fp-1", __simulate: { rows: 3, delayMs: 20 } },
      redactedUrl: "jdbc:oracle:thin:@//db:1521/ORCLPDB1"
    }
  };
  const service = new OracleQueryService({ bridge: manager, resolveDescriptor: async (id) => descriptors[id] ?? null });

  const makeResolver = () =>
    new DataSourceResolver({
      readJsonRows: async () => [{ J: 1 }],
      runOracleRuntimeQuery: async (profile) => {
        const r = await service.execute(
          { connectionProfileId: profile.connectionProfileId, sql: profile.query.sql, binds: [], timeoutMs: 30_000, maxRows: 100, fetchSize: 200 },
          { source: "runtime-query" }
        );
        return r.rows;
      }
    });

  try {
    // ── Snapshot FIRST, before any query, so we can prove the bridge never even spawned ──
    console.log("Snapshot mode (real bridge must never start):");
    {
      const resolver = makeResolver();
      const resolved = resolver.resolve(snapshotProfile("ds-snap"));
      check("snapshot resolves to stored rows", resolved.rows.length === 2 && resolved.oracleMode === "snapshot");
      check("snapshot exposes no lazy loader", resolved.loadRows === undefined);
      check("snapshot → zero executeQuery RPCs", executeQueryRpcs === 0);
      check("snapshot → the Java bridge process was NEVER started", manager.isRunning() === false);
    }

    console.log("Lazy runtime execution (real executeQuery RPC counter):");

    // 1) Unreferenced runtime source → zero queries, bridge still not started.
    {
      const resolver = makeResolver();
      resolver.resolve(runtimeProfile("ds-unref"));
      await new Promise((r) => setTimeout(r, 40));
      check("unreferenced runtime source → 0 RPCs", executeQueryRpcs === 0);
      check("unreferenced runtime source → bridge still not started", manager.isRunning() === false);
    }

    // 2) Late node reference → executes exactly when rows are consumed.
    {
      const before = executeQueryRpcs;
      const resolver = makeResolver();
      const resolved = resolver.resolve(runtimeProfile("ds-late"));
      check("resolve() alone dispatches no RPC", executeQueryRpcs === before);
      const rows = await resolved.loadRows!();
      check("consuming rows dispatches exactly 1 real RPC", executeQueryRpcs === before + 1);
      check("rows came back from the real bridge", rows.length === 3);
    }

    // 3) Cancelled before the consuming node → zero queries.
    {
      const before = executeQueryRpcs;
      const resolver = makeResolver();
      resolver.resolve(runtimeProfile("ds-cancel"));
      resolver.clearCache(); // run ended before the consumer was reached
      await new Promise((r) => setTimeout(r, 40));
      check("cancelled before consumer → 0 RPCs", executeQueryRpcs === before);
    }

    // 4) Loop input → one query before materialization; loop iterates cached rows.
    {
      const before = executeQueryRpcs;
      const resolver = makeResolver();
      const resolved = resolver.resolve(runtimeProfile("ds-loop"));
      const rows = await resolved.loadRows!();
      let seen = 0;
      for (const _ of rows) seen += 1;
      await resolved.loadRows!(); // loop body re-reads: must NOT re-query
      check("loop input → exactly 1 RPC, rows reused", executeQueryRpcs === before + 1 && seen === 3);
    }

    // 5) Parallel consumers in one run → a single in-flight query.
    {
      const before = executeQueryRpcs;
      const resolver = makeResolver();
      const resolved = resolver.resolve(runtimeProfile("ds-parallel"));
      const [a, b, c] = await Promise.all([resolved.loadRows!(), resolved.loadRows!(), resolved.loadRows!()]);
      check("3 parallel consumers → exactly 1 RPC (single-flight)", executeQueryRpcs === before + 1);
      check("all parallel consumers get the same rows", a.length === 3 && b.length === 3 && c.length === 3);
    }

    // 6) Same Data Source across two runs → one query per run.
    {
      const before = executeQueryRpcs;
      const run1 = makeResolver();
      await run1.resolve(runtimeProfile("ds-shared")).loadRows!();
      await run1.resolve(runtimeProfile("ds-shared")).loadRows!(); // same run → cached
      const run2 = makeResolver();
      await run2.resolve(runtimeProfile("ds-shared")).loadRows!();
      check("two runs → exactly 2 RPCs (one per run, not 3)", executeQueryRpcs === before + 2);
    }

    // 7) Failed first attempt → cache entry evicted → retry re-executes.
    {
      const before = executeQueryRpcs;
      let attempt = 0;
      const resolver = new DataSourceResolver({
        readJsonRows: async () => [],
        runOracleRuntimeQuery: async (profile) => {
          attempt += 1;
          // First attempt asks the real bridge to simulate a failure; second succeeds.
          const id = attempt === 1 ? "fail" : "prod";
          const r = await service.execute(
            { connectionProfileId: id, sql: profile.query.sql, binds: [], timeoutMs: 30_000, maxRows: 100, fetchSize: 200 },
            { source: "runtime-query" }
          );
          return r.rows;
        }
      });
      descriptors.fail = {
        descriptor: { url: "jdbc:oracle:thin:@//db:1521/ORCLPDB1", username: "reader", password: "pw", poolKey: "fp-1", __simulate: { error: "DRIVER_ERROR" } },
        redactedUrl: "jdbc:oracle:thin:@//db:1521/ORCLPDB1"
      };
      const resolved = resolver.resolve(runtimeProfile("ds-retry"));
      let threw = false;
      try {
        await resolved.loadRows!();
      } catch (err) {
        threw = err instanceof OracleBridgeCallError;
      }
      const rows = await resolved.loadRows!(); // cache must have been evicted
      check("failed attempt surfaces a safe bridge error", threw);
      check("failed attempt evicted from cache → retry re-executes (2 RPCs)", executeQueryRpcs === before + 2 && rows.length === 3);
    }
  } finally {
    await manager.dispose();
  }

  // ── Phase 04 product behavior: Oracle runtime UNAVAILABLE must not break the product ──
  console.log("Fail-closed product behavior (Oracle runtime unavailable):");
  {
    const resolver = new DataSourceResolver({
      readJsonRows: async () => [{ J: 1 }, { J: 2 }],
      // Simulates a packaged build with no real driver: the feature is unavailable, never mocked.
      runOracleRuntimeQuery: async () => {
        throw new OracleBridgeCallError("DRIVER_UNAVAILABLE", "The Oracle JDBC driver is not available in this build.");
      }
    });

    const json = resolver.resolve(jsonProfile("ds-json") as DataSourceProfile);
    check("JSON Data Sources keep working", json.type === "jsonArray");

    const snap = resolver.resolve(snapshotProfile("ds-snap-offline"));
    check("Oracle Snapshot Data Sources keep working offline", snap.rows.length === 2);

    const runtime = resolver.resolve(runtimeProfile("ds-runtime-unavail"));
    let category = "";
    try {
      await runtime.loadRows!();
    } catch (err) {
      category = err instanceof OracleBridgeCallError ? err.category : "UNKNOWN";
    }
    check("Runtime Data Sources fail SAFELY with DRIVER_UNAVAILABLE (no mock rows, no crash)", category === "DRIVER_UNAVAILABLE");

    // A failure must not poison the resolver: other sources still resolve afterwards.
    const jsonAfter = resolver.resolve(jsonProfile("ds-json-2") as DataSourceProfile);
    check("a failed Oracle source does not break subsequent resolution", jsonAfter.type === "jsonArray");
  }

  console.log(`\n${passed} passed, ${failed} failed  (real executeQuery RPCs dispatched: ${executeQueryRpcs})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
