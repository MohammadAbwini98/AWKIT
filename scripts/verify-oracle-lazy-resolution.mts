/**
 * Lazy Oracle Data Source resolution (Phase 07). Proves the authoritative DataSourceResolver executes
 * a Runtime Oracle query ONLY when its rows are actually consumed, shares a single in-flight query
 * across concurrent consumers, scopes the cache to one run, and never touches the bridge/database for
 * Snapshot sources. Pure — a counting loader stands in for OracleQueryService, so no bridge/DB is used.
 *
 * Run: `npm run verify:oracle-lazy-resolution`.
 */
import { DataSourceResolver } from "../src/data/DataSourceResolver";
import type { OracleDataSourceProfile } from "../src/data/DataSourceProfile";

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

function runtimeProfile(id: string): OracleDataSourceProfile {
  return {
    id,
    name: `Runtime ${id}`,
    type: "oracle",
    connectionProfileId: "conn-1",
    mode: "runtime",
    query: { sql: "SELECT id FROM orders", binds: [], timeoutMs: 30_000, maxRows: 100, fetchSize: 200 },
    createdAt: "2026-07-17T00:00:00Z",
    updatedAt: "2026-07-17T00:00:00Z"
  };
}

function snapshotProfile(id: string): OracleDataSourceProfile {
  return {
    id,
    name: `Snapshot ${id}`,
    type: "oracle",
    connectionProfileId: "conn-1",
    mode: "snapshot",
    query: { sql: "SELECT id FROM orders", binds: [], timeoutMs: 30_000, maxRows: 100, fetchSize: 200 },
    snapshot: {
      rows: [{ ID: 1 }, { ID: 2 }],
      columns: [{ name: "ID", jdbcType: "NUMBER" }],
      rowCount: 2,
      capturedAt: "2026-07-17T00:00:00Z",
      queryHash: "h",
      connectionFingerprint: "fp",
      status: "ready",
      truncated: false
    },
    createdAt: "2026-07-17T00:00:00Z",
    updatedAt: "2026-07-17T00:00:00Z"
  };
}

/** A resolver whose runtime query counts executions and resolves after a tick (to expose races). */
function makeResolver() {
  let queries = 0;
  const resolver = new DataSourceResolver({
    readJsonRows: async () => [],
    runOracleRuntimeQuery: async () => {
      queries += 1;
      await new Promise((r) => setTimeout(r, 15));
      return [{ ID: 1 }, { ID: 2 }, { ID: 3 }];
    }
  });
  return { resolver, queries: () => queries };
}

async function main(): Promise<void> {
  console.log("Lazy runtime execution:");

  // 1) Unreferenced runtime source → zero queries.
  {
    const { resolver, queries } = makeResolver();
    resolver.resolve(runtimeProfile("ds-unref"));
    await new Promise((r) => setTimeout(r, 30));
    check("unreferenced runtime source → 0 queries", queries() === 0);
  }

  // 2) Late-node reference → executes exactly when rows are consumed.
  {
    const { resolver, queries } = makeResolver();
    const resolved = resolver.resolve(runtimeProfile("ds-late"));
    check("resolve() alone runs no query", queries() === 0);
    const rows = await resolved.loadRows!();
    check("consuming rows executes the query once", queries() === 1 && rows.length === 3);
  }

  // 3) Cancel before consumer → zero queries.
  {
    const { resolver, queries } = makeResolver();
    resolver.resolve(runtimeProfile("ds-cancel"));
    // "cancel" = the consumer is never reached, so loadRows is never called.
    resolver.clearCache();
    await new Promise((r) => setTimeout(r, 30));
    check("cancel before consumer → 0 queries", queries() === 0);
  }

  // 4) Loop input → one query before materialization, loop iterates cached rows.
  {
    const { resolver, queries } = makeResolver();
    const resolved = resolver.resolve(runtimeProfile("ds-loop"));
    const rows = await resolved.loadRows!(); // materialize once for the loop
    let seen = 0;
    for (const _ of rows) seen += 1; // loop body would re-read cached rows, not re-query
    const again = await resolved.loadRows!();
    check("loop input → single query, rows reused", queries() === 1 && seen === 3 && again.length === 3);
  }

  // 5) Parallel consumers in one run → one in-flight query (single-flight).
  {
    const { resolver, queries } = makeResolver();
    const resolved = resolver.resolve(runtimeProfile("ds-parallel"));
    const [a, b, c] = await Promise.all([resolved.loadRows!(), resolved.loadRows!(), resolved.loadRows!()]);
    check("3 parallel consumers → exactly 1 query", queries() === 1);
    check("all consumers get the same rows", a.length === 3 && b.length === 3 && c.length === 3);
  }

  // 6) Two workflow runs → one query per run (cache scoped per resolver/run).
  {
    let total = 0;
    const mkRun = () =>
      new DataSourceResolver({
        readJsonRows: async () => [],
        runOracleRuntimeQuery: async () => {
          total += 1;
          return [{ ID: 1 }];
        }
      });
    const run1 = mkRun();
    await run1.resolve(runtimeProfile("ds-shared")).loadRows!();
    await run1.resolve(runtimeProfile("ds-shared")).loadRows!(); // same run, same id → cached
    const run2 = mkRun();
    await run2.resolve(runtimeProfile("ds-shared")).loadRows!();
    check("two runs → one query per run (2 total, not 3)", total === 2);
  }

  console.log("Snapshot mode:");

  // 7) Snapshot mode → zero bridge/database activity.
  {
    let queries = 0;
    const resolver = new DataSourceResolver({
      readJsonRows: async () => [],
      runOracleRuntimeQuery: async () => {
        queries += 1;
        return [];
      }
    });
    const resolved = resolver.resolve(snapshotProfile("ds-snap"));
    check("snapshot resolves to stored rows", resolved.rows.length === 2 && resolved.oracleMode === "snapshot");
    check("snapshot exposes no lazy loader", resolved.loadRows === undefined);
    check("snapshot runs zero queries", queries === 0);
  }

  // 8) A failed runtime query is NOT cached (a retry may re-execute).
  {
    let attempts = 0;
    const resolver = new DataSourceResolver({
      readJsonRows: async () => [],
      runOracleRuntimeQuery: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
        return [{ ID: 9 }];
      }
    });
    const resolved = resolver.resolve(runtimeProfile("ds-retry"));
    let firstThrew = false;
    try {
      await resolved.loadRows!();
    } catch {
      firstThrew = true;
    }
    const rows = await resolved.loadRows!();
    check("failed attempt is not cached; retry re-executes", firstThrew && attempts === 2 && rows.length === 1);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
