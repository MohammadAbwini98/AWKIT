/**
 * Oracle Data Source model + runtime resolution (Phase 04). Pure — no Java, no database. Proves the
 * authoritative DataSourceResolver normalizes every type to the same array-of-objects contract:
 * JSON passthrough, Oracle snapshot (offline stored rows), and Oracle runtime (single-flight
 * per-run cached lazy loader). Also covers query-hash + snapshot staleness.
 *
 * Run: `npm run verify:oracle-data-source`.
 */
import { DataSourceResolver, computeQueryHash, isSnapshotStale } from "../src/data/DataSourceResolver";
import { resolveDataSourceBinds } from "../src/oracle/OracleDataSourceBinds";
import { OracleBridgeCallError } from "../src/oracle/OracleBridgeProtocol";
import { materializeDataSourceRows } from "../src/runner/InstanceExecutionContext";
import {
  isJsonArrayDataSource,
  isOracleDataSource,
  type JsonArrayDataSourceProfile,
  type OracleBindDefinition,
  type OracleDataSourceProfile
} from "../src/data/DataSourceProfile";

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

function oracleProfile(overrides: Partial<OracleDataSourceProfile> = {}): OracleDataSourceProfile {
  return {
    id: "orders",
    name: "Orders",
    type: "oracle",
    connectionProfileId: "prod",
    mode: "runtime",
    query: { sql: "SELECT * FROM orders", binds: [], timeoutMs: 30000, maxRows: 1000, fetchSize: 200 },
    ...overrides
  };
}

async function main(): Promise<void> {
  console.log("Discriminated union guards:");
  const json: JsonArrayDataSourceProfile = { id: "c", name: "customers.json", type: "jsonArray", file: "/x.json", path: "$" };
  check("jsonArray recognized", isJsonArrayDataSource(json) && !isOracleDataSource(json));
  check("oracle recognized", isOracleDataSource(oracleProfile()) && !isJsonArrayDataSource(oracleProfile()));
  check("legacy profile without type reads as jsonArray", isJsonArrayDataSource({ id: "l", name: "n", file: "/f", path: "$" } as JsonArrayDataSourceProfile));

  console.log("Resolver — JSON passthrough:");
  let jsonReads = 0;
  let runtimeRuns = 0;
  const resolver = new DataSourceResolver({
    readJsonRows: async () => {
      jsonReads += 1;
      return [{ id: 1 }];
    },
    runOracleRuntimeQuery: async () => {
      runtimeRuns += 1;
      await new Promise((r) => setTimeout(r, 20));
      return [{ ID: 1, NAME: "a" }, { ID: 2, NAME: "b" }];
    }
  });
  const rJson = resolver.resolve(json);
  check("json resolves to jsonArray with file+path", rJson.type === "jsonArray" && rJson.file === "/x.json" && rJson.rootArrayPath === "$");
  check("json has no eager rows / no loadRows (legacy lazy file read)", rJson.rows.length === 0 && rJson.loadRows === undefined);

  console.log("Resolver — Oracle snapshot (offline stored rows):");
  const snapProfile = oracleProfile({
    id: "snap",
    mode: "snapshot",
    snapshot: {
      rows: [{ ID: 10, NAME: "x" }, { ID: 11, NAME: "y" }],
      columns: [{ name: "ID", jdbcType: "NUMBER" }, { name: "NAME", jdbcType: "VARCHAR2" }],
      rowCount: 2,
      capturedAt: new Date().toISOString(),
      queryHash: computeQueryHash(oracleProfile().query),
      connectionFingerprint: "fp-1",
      status: "ready"
    }
  });
  const rSnap = resolver.resolve(snapProfile);
  check("snapshot resolves to stored rows eagerly", rSnap.oracleMode === "snapshot" && rSnap.rows.length === 2 && !rSnap.loadRows);
  check("snapshot needs no runtime query", runtimeRuns === 0);

  console.log("Resolver — Oracle runtime (single-flight per-run cache):");
  const rRun = resolver.resolve(oracleProfile({ id: "orders" }));
  check("runtime resolves with a lazy loader, no eager rows", rRun.oracleMode === "runtime" && rRun.rows.length === 0 && typeof rRun.loadRows === "function");
  // Two concurrent consumers must share ONE in-flight query.
  const [a, b] = await Promise.all([rRun.loadRows!(), rRun.loadRows!()]);
  check("concurrent loads share one in-flight query (single-flight)", runtimeRuns === 1);
  check("both consumers get the same rows", JSON.stringify(a) === JSON.stringify(b) && a.length === 2);
  // A third call reuses the cached result (still one run).
  await rRun.loadRows!();
  check("subsequent load reuses cached result", runtimeRuns === 1);
  // A fresh resolver (new run) re-executes.
  const resolver2 = new DataSourceResolver({ readJsonRows: async () => [], runOracleRuntimeQuery: async () => { runtimeRuns += 1; return []; } });
  await resolver2.resolve(oracleProfile({ id: "orders" })).loadRows!();
  check("cache never crosses resolver instances (runs)", runtimeRuns === 2);

  console.log("Runtime cache — failed query is not cached:");
  let attempts = 0;
  const flaky = new DataSourceResolver({
    readJsonRows: async () => [],
    runOracleRuntimeQuery: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient");
      return [{ ok: 1 }];
    }
  });
  const rFlaky = flaky.resolve(oracleProfile({ id: "orders" }));
  let threw = false;
  try {
    await rFlaky.loadRows!();
  } catch {
    threw = true;
  }
  const retryRows = await rFlaky.loadRows!();
  check("first attempt rejects", threw);
  check("failed attempt is not cached — retry re-executes and succeeds", attempts === 2 && retryRows.length === 1);

  console.log("Query hash + snapshot staleness:");
  check("query hash stable", computeQueryHash(oracleProfile().query) === computeQueryHash(oracleProfile().query));
  check("query hash changes with SQL", computeQueryHash(oracleProfile().query) !== computeQueryHash(oracleProfile({ query: { sql: "SELECT 1 FROM dual", binds: [], timeoutMs: 30000, maxRows: 1000, fetchSize: 200 } }).query));
  check("fresh snapshot not stale", !isSnapshotStale(snapProfile, "fp-1"));
  check("snapshot stale when connection fingerprint changes", isSnapshotStale(snapProfile, "fp-2"));
  const editedQuery = oracleProfile({ id: "snap", mode: "snapshot", snapshot: snapProfile.snapshot, query: { sql: "SELECT 2 FROM dual", binds: [], timeoutMs: 30000, maxRows: 1000, fetchSize: 200 } });
  check("snapshot stale when query changes", isSnapshotStale(editedQuery, "fp-1"));
  check("json passthrough reads still lazy (not triggered by resolve)", jsonReads === 0);

  console.log("Data Source binds (resolution-time: static / env / workflowInput):");
  const dsBinds: OracleBindDefinition[] = [
    { name: "region", jdbcType: "STRING", source: { kind: "static", value: "EU" } },
    { name: "limit", jdbcType: "INTEGER", source: { kind: "env", key: "ORA_LIMIT" } },
    { name: "tenant", jdbcType: "STRING", source: { kind: "workflowInput", key: "tenant" } }
  ];
  const wire = resolveDataSourceBinds(dsBinds, { env: { ORA_LIMIT: "50" }, workflowInputs: { tenant: "acme" } });
  check("static bind resolves", wire[0].value === "EU");
  check("env bind resolves and types to integer", wire[1].value === 50);
  check("workflowInput bind resolves", wire[2].value === "acme");
  check(
    "default fills an empty non-required bind",
    resolveDataSourceBinds([{ name: "x", jdbcType: "STRING", source: { kind: "static", value: "" }, defaultValue: "d" }])[0].value === "d"
  );
  let requiredThrew = false;
  try {
    resolveDataSourceBinds([{ name: "x", jdbcType: "STRING", required: true, source: { kind: "static", value: "" } }]);
  } catch (err) {
    requiredThrew = err instanceof OracleBridgeCallError;
  }
  check("required empty bind rejected", requiredThrew);
  let dynamicThrew = false;
  try {
    resolveDataSourceBinds([{ name: "r", jdbcType: "STRING", source: { kind: "currentRow", key: "id" } }]);
  } catch (err) {
    dynamicThrew = err instanceof OracleBridgeCallError;
  }
  check("per-row bind rejected on a Data Source (belongs on the Oracle node)", dynamicThrew);

  console.log("materializeDataSourceRows (loop integration):");
  check("snapshot source materializes eager rows", (await materializeDataSourceRows(resolver.resolve(snapProfile))).length === 2);
  check("runtime source materializes via loadRows", (await materializeDataSourceRows(resolver.resolve(oracleProfile({ id: "orders" })))).length === 2);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
