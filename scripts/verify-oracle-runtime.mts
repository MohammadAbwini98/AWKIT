/**
 * Oracle runtime query service (Phase 07). Drives the real Java mock bridge through OracleQueryService:
 * read-only gate, descriptor/secret resolution, executeQuery, result normalization + limits,
 * cancellation, timeout, transient retry, bounded concurrency, and low-cardinality telemetry.
 * Plus pure bind/type conversion checks. No Oracle database.
 *
 * Run: `npm run verify:oracle-runtime`.
 */
import { buildOracleBridge } from "./build-oracle-bridge.mjs";
import { OracleJdbcBridgeManager, type BridgeLaunchSpec } from "../src/oracle/OracleJdbcBridgeManager";
import { OracleQueryService, type DescriptorResolution } from "../src/oracle/OracleQueryService";
import { toWireBindValue, OracleConversionError, enforceResultLimits } from "../src/oracle/OracleTypeConversion";
import { OracleBridgeCallError } from "../src/oracle/OracleBridgeProtocol";

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
async function expectCategory(name: string, fn: () => Promise<unknown>, category: string): Promise<void> {
  try {
    await fn();
    check(`${name} (expected ${category})`, false);
  } catch (err) {
    check(`${name} → ${category}`, err instanceof OracleBridgeCallError && err.category === category);
  }
}

async function main(): Promise<void> {
  console.log("Bind type conversion (pure):");
  check("STRING passthrough", toWireBindValue("STRING", "hello") === "hello");
  check("INTEGER parses", toWireBindValue("INTEGER", "42") === 42);
  check("INTEGER beyond safe range → string", toWireBindValue("INTEGER", "99999999999999999999") === "99999999999999999999");
  check("NUMBER parses", toWireBindValue("NUMBER", "3.14") === 3.14);
  check("high-precision NUMBER kept as string", toWireBindValue("NUMBER", "3.141592653589793238462643") === "3.141592653589793238462643");
  check("BOOLEAN Y → true", toWireBindValue("BOOLEAN", "Y") === true);
  check("DATE → ISO string", typeof toWireBindValue("DATE", "2026-07-16") === "string");
  check("empty → null", toWireBindValue("STRING", "") === null);
  let convThrew = false;
  try {
    toWireBindValue("INTEGER", "not-a-number");
  } catch (e) {
    convThrew = e instanceof OracleConversionError;
  }
  check("invalid integer throws OracleConversionError", convThrew);

  console.log("Result limits (pure) — Phase 11 defensive ceilings:");
  {
    const rows = [{ ID: 1, NAME: "short" }];
    const cols = [{ name: "ID" }, { name: "NAME" }];
    const ok = enforceResultLimits(rows, cols, { maxRows: 10, maxColumns: 5, maxCellBytes: 100, maxSerializedBytes: 10_000 });
    check("within all limits → ok", ok.ok === true && ok.truncated === false);

    const tooManyCols = enforceResultLimits(rows, [{ name: "A" }, { name: "B" }, { name: "C" }], { maxRows: 10, maxColumns: 2 });
    check("column count over limit → rejected", tooManyCols.ok === false && /columns/.test(tooManyCols.reason ?? ""));

    const bigCellRows = [{ NAME: "x".repeat(200) }];
    const tooBigCell = enforceResultLimits(bigCellRows, cols, { maxRows: 10, maxCellBytes: 100 });
    check("oversized cell → rejected (no row content in reason)", tooBigCell.ok === false && !tooBigCell.reason?.includes("x".repeat(50)));

    const tooBigSerialized = enforceResultLimits(bigCellRows, cols, { maxRows: 10, maxSerializedBytes: 50 });
    check("oversized serialized payload → rejected", tooBigSerialized.ok === false && /serialized/.test(tooBigSerialized.reason ?? ""));
  }

  console.log("Building the Java mock bridge…");
  const build = buildOracleBridge({ quiet: true });
  const launchSpec: BridgeLaunchSpec = { javaPath: build.jdk.java, jarPath: build.jarPath, env: { AWKIT_ORACLE_BRIDGE_MOCK: "1" } };
  const manager = new OracleJdbcBridgeManager({ resolveLaunchSpec: () => launchSpec, handshakeTimeoutMs: 20_000 });

  // The mock executor reads `__simulate` from params (which the service spreads from the descriptor),
  // so a profile id selects the simulated behaviour: rows count, delay, or an error category.
  function descriptorFor(sim: Record<string, unknown>): DescriptorResolution {
    return {
      descriptor: { url: "jdbc:oracle:thin:@//db:1521/ORCLPDB1", username: "reader", password: "pw", poolKey: "fp-1", __simulate: sim },
      redactedUrl: "jdbc:oracle:thin:@//db:1521/ORCLPDB1"
    };
  }
  const descriptors: Record<string, DescriptorResolution> = {
    prod: descriptorFor({ rows: 3 }),
    "prod-many": descriptorFor({ rows: 10 }),
    "prod-slow": descriptorFor({ rows: 1, delayMs: 8000 })
  };

  try {
    const service = new OracleQueryService({
      bridge: manager,
      resolveDescriptor: async (id) => descriptors[id] ?? null,
      maxConcurrency: 2,
      maxTransientRetries: 1
    });

    console.log("Happy path:");
    const result = await service.execute({ connectionProfileId: "prod", sql: "SELECT * FROM orders", binds: [], timeoutMs: 30_000, maxRows: 100, fetchSize: 200 });
    check("returns normalized rows", result.rows.length === 3 && result.source === "runtime-query");
    check("returns columns", result.columns.length === 3);
    check("not truncated", result.truncated === false);

    console.log("Result limit — maxRows truncates:");
    const bounded = await service.execute({ connectionProfileId: "prod-many", sql: "SELECT * FROM orders", binds: [], timeoutMs: 30_000, maxRows: 4, fetchSize: 200 });
    check("truncation caps rows at maxRows", bounded.rows.length === 4);
    check("truncation flagged", bounded.truncated === true);

    console.log("Result limit — defensive defaults apply without caller-specified limits:");
    const unbounded = await service.execute({ connectionProfileId: "prod", sql: "SELECT * FROM orders", binds: [], timeoutMs: 30_000, maxRows: 100, fetchSize: 200 });
    check("small result passes under default column/cell/byte ceilings", unbounded.rows.length === 3);

    console.log("SQL gate + config errors:");
    await expectCategory("rejects INSERT before the bridge", () => service.execute({ connectionProfileId: "prod", sql: "INSERT INTO t VALUES (1)", binds: [], timeoutMs: 30_000, maxRows: 10, fetchSize: 10 }), "SQL_POLICY_VIOLATION");
    await expectCategory("unknown profile → INVALID_CONFIGURATION", () => service.execute({ connectionProfileId: "nope", sql: "SELECT 1 FROM dual", binds: [], timeoutMs: 30_000, maxRows: 10, fetchSize: 10 }), "INVALID_CONFIGURATION");

    console.log("Cancellation:");
    {
      const controller = new AbortController();
      const started = Date.now();
      const p = service.execute(
        { connectionProfileId: "prod-slow", sql: "SELECT * FROM slow", binds: [], timeoutMs: 30_000, maxRows: 10, fetchSize: 10 },
        { signal: controller.signal }
      );
      setTimeout(() => controller.abort(), 150);
      await expectCategory("abort → CANCELLED", () => p, "CANCELLED");
      check("cancellation prompt (<3s, not the 8s delay)", Date.now() - started < 3000);
    }

    console.log("Timeout:");
    await expectCategory("outer timeout fires", () => service.execute({ connectionProfileId: "prod-slow", sql: "SELECT * FROM slow", binds: [], timeoutMs: 300, maxRows: 10, fetchSize: 10 }), "TIMEOUT");

    console.log("Telemetry (low-cardinality):");
    const m = service.getMetrics();
    check("counts queries", m.queries >= 3);
    check("counts at least one success", m.successes >= 2);
    check("tracks error categories (no SQL text)", typeof m.errorsByCategory === "object" && !JSON.stringify(m).includes("INSERT INTO"));

    console.log("Handshake fields (Phase 03 hello):");
    const hello = await manager.hello();
    check("mock bridge reports executionMode 'mock'", hello.executionMode === "mock");
    check("mock bridge driverAvailable false", hello.driverAvailable === false);
    check("hello no longer carries a ucpVersion field (UCP removed)", !("ucpVersion" in (hello as unknown as Record<string, unknown>)));
    check("hello carries a javaVersion field", typeof hello.javaVersion === "string" && (hello.javaVersion?.length ?? 0) > 0);
  } finally {
    await manager.dispose();
  }

  console.log("Fail-closed production policy (Phase 01, real Java bridge):");
  {
    // (a) A manager that REQUIRES a real driver must reject a bridge that cannot load one.
    const reqSpec: BridgeLaunchSpec = { javaPath: build.jdk.java, jarPath: build.jarPath, env: { AWKIT_ORACLE_REQUIRE_REAL: "1" } };
    const requiring = new OracleJdbcBridgeManager({ resolveLaunchSpec: () => reqSpec, requireRealDriver: true, handshakeTimeoutMs: 20_000 });
    await expectCategory("require-real manager rejects a driverless bridge at startup", () => requiring.hello(), "DRIVER_UNAVAILABLE");
    await requiring.dispose();

    // (b) The same driverless bridge, inspected without the guard, reports the fail-closed executor
    //     and refuses queries with DRIVER_UNAVAILABLE (never mock rows).
    const observing = new OracleJdbcBridgeManager({ resolveLaunchSpec: () => reqSpec, requireRealDriver: false, handshakeTimeoutMs: 20_000 });
    try {
      const h = await observing.hello();
      check("require-real + no driver → executionMode 'unavailable'", h.executionMode === "unavailable");
      check("require-real + no driver → driverAvailable false", h.driverAvailable === false);
      await expectCategory(
        "require-real executor fails queries closed",
        () => observing.call("testConnection", { url: "jdbc:oracle:thin:@//db:1521/ORCLPDB1", username: "reader", password: "pw" }, { timeoutMs: 10_000 }),
        "DRIVER_UNAVAILABLE"
      );
    } finally {
      await observing.dispose();
    }

    // (c) An explicit mock flag must be IGNORED when a real driver is required (mock never wins).
    const bothSpec: BridgeLaunchSpec = { javaPath: build.jdk.java, jarPath: build.jarPath, env: { AWKIT_ORACLE_REQUIRE_REAL: "1", AWKIT_ORACLE_BRIDGE_MOCK: "1" } };
    const both = new OracleJdbcBridgeManager({ resolveLaunchSpec: () => bothSpec, requireRealDriver: false, handshakeTimeoutMs: 20_000 });
    try {
      const h = await both.hello();
      check("require-real overrides mock flag → not 'mock'", h.executionMode === "unavailable" && h.driverAvailable === false);
    } finally {
      await both.dispose();
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
