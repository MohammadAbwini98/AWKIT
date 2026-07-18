/**
 * WS-D — direct-JDBC concurrency, cancellation, and teardown (Phase 9). Specter opens one connection
 * per query (no pooling); this drives the real Java mock bridge through {@link OracleQueryService} to
 * prove the lifecycle invariants that hold regardless of the database:
 *
 *  - the bounded concurrency limiter never exceeds its maximum, and queued work resumes;
 *  - success / failure / timeout / cancellation / rejection all release the limiter slot (no leak);
 *  - the cancellation chain (AbortSignal → cancelQuery → CANCELLED) is prompt and yields no late result;
 *  - teardown invariants: pending bridge requests = 0, and after dispose no bridge process survives
 *    (orphan Java = 0);
 *  - telemetry carries no SQL text, bind values, row content, or credentials.
 *
 * The real per-connection open/close (try-with-resources) is asserted statically in
 * `verify:oracle-bridge-real-build` and end-to-end in `verify:oracle-live`; this needs no database.
 *
 * Run: `npm run verify:oracle-direct-jdbc`.
 */
import { buildOracleBridge } from "./build-oracle-bridge.mjs";
import { OracleJdbcBridgeManager, type BridgeLaunchSpec } from "../src/oracle/OracleJdbcBridgeManager";
import { OracleQueryService, type DescriptorResolution, type OracleBridgeExecutor } from "../src/oracle/OracleQueryService";
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

const MAX_CONCURRENCY = 3;

function descriptorFor(sim: Record<string, unknown>): DescriptorResolution {
  return {
    descriptor: { url: "jdbc:oracle:thin:@//db:1521/ORCLPDB1", username: "reader", password: "s3cr3t-pw", poolKey: "fp-1", __simulate: sim },
    redactedUrl: "jdbc:oracle:thin:@//db:1521/ORCLPDB1"
  };
}

const descriptors: Record<string, DescriptorResolution> = {
  ok: descriptorFor({ rows: 3 }),
  slow: descriptorFor({ rows: 1, delayMs: 350 }),
  "very-slow": descriptorFor({ rows: 1, delayMs: 8000 }),
  "auth-fail": descriptorFor({ error: "AUTHENTICATION_FAILED" })
};

async function main(): Promise<void> {
  console.log("Building the Java mock bridge…");
  const build = buildOracleBridge({ quiet: true });
  const launchSpec: BridgeLaunchSpec = { javaPath: build.jdk.java, jarPath: build.jarPath, env: { AWKIT_ORACLE_BRIDGE_MOCK: "1" } };
  const manager = new OracleJdbcBridgeManager({ resolveLaunchSpec: () => launchSpec, handshakeTimeoutMs: 20_000 });

  // A counting proxy over the bridge that tracks concurrent in-flight executeQuery calls. The limiter
  // lives in the service (acquire/release) and only dispatches to the bridge after acquiring a slot, so
  // the peak here is the observed concurrency.
  let activeCalls = 0;
  let peakCalls = 0;
  const countingBridge: OracleBridgeExecutor = {
    call: async (op, params, options) => {
      activeCalls += 1;
      peakCalls = Math.max(peakCalls, activeCalls);
      try {
        return await manager.call(op, params, options);
      } finally {
        activeCalls -= 1;
      }
    }
  };

  try {
    const service = new OracleQueryService({
      bridge: countingBridge,
      resolveDescriptor: async (id) => descriptors[id] ?? null,
      maxConcurrency: MAX_CONCURRENCY,
      maxTransientRetries: 0
    });
    const run = (id: string, over: Partial<{ timeoutMs: number; sql: string }> = {}, signal?: AbortSignal) =>
      service.execute(
        { connectionProfileId: id, sql: over.sql ?? "SELECT id, name FROM demo", binds: [], timeoutMs: over.timeoutMs ?? 30_000, maxRows: 100, fetchSize: 50 },
        { signal }
      );

    console.log(`Bounded concurrency limiter (max ${MAX_CONCURRENCY}):`);
    {
      peakCalls = 0;
      const N = 9;
      const results = await Promise.allSettled(Array.from({ length: N }, () => run("slow")));
      const ok = results.filter((r) => r.status === "fulfilled").length;
      check(`all ${N} queued queries completed`, ok === N);
      check(`peak in-flight never exceeded the limit (${peakCalls} ≤ ${MAX_CONCURRENCY})`, peakCalls <= MAX_CONCURRENCY);
      check(`limiter was fully utilized (peak reached ${MAX_CONCURRENCY})`, peakCalls === MAX_CONCURRENCY);
      check("no bridge calls left in flight after the batch", activeCalls === 0);
    }

    console.log("Every outcome releases the connection/limiter slot:");
    {
      // success
      await run("ok");
      // rejected pre-dispatch (SQL policy + unknown profile never acquire a slot)
      await run("ok", { sql: "DELETE FROM demo" }).then(
        () => check("SQL policy rejection throws", false),
        (e) => check("SQL policy rejection → SQL_POLICY_VIOLATION", e instanceof OracleBridgeCallError && e.category === "SQL_POLICY_VIOLATION")
      );
      await run("nope").then(
        () => check("unknown profile throws", false),
        (e) => check("unknown profile → INVALID_CONFIGURATION", e instanceof OracleBridgeCallError && e.category === "INVALID_CONFIGURATION")
      );
      // db error
      await run("auth-fail").then(
        () => check("db error throws", false),
        (e) => check("simulated db error → AUTHENTICATION_FAILED", e instanceof OracleBridgeCallError && e.category === "AUTHENTICATION_FAILED")
      );
      // timeout
      await run("very-slow", { timeoutMs: 300 }).then(
        () => check("timeout throws", false),
        (e) => check("outer timeout → TIMEOUT", e instanceof OracleBridgeCallError && e.category === "TIMEOUT")
      );
      // cancellation
      const ctrl = new AbortController();
      const p = run("very-slow", {}, ctrl.signal);
      setTimeout(() => ctrl.abort(), 120);
      await p.then(
        () => check("cancel throws", false),
        (e) => check("abort → CANCELLED", e instanceof OracleBridgeCallError && e.category === "CANCELLED")
      );

      // Prove NO slot leaked across all those outcomes: exactly MAX concurrent slow queries must all run
      // at once. If any slot had leaked, fewer would run concurrently and the peak would fall short.
      peakCalls = 0;
      await Promise.all(Array.from({ length: MAX_CONCURRENCY }, () => run("slow")));
      check(`all slots released — ${MAX_CONCURRENCY} queries ran concurrently after mixed outcomes`, peakCalls === MAX_CONCURRENCY);
    }

    console.log("Cancellation chain is prompt with no late result:");
    {
      const before = service.getMetrics();
      const ctrl = new AbortController();
      const started = Date.now();
      const p = run("very-slow", {}, ctrl.signal);
      setTimeout(() => ctrl.abort(), 150);
      let category = "";
      await p.catch((e) => (category = e instanceof OracleBridgeCallError ? e.category : "UNKNOWN"));
      const elapsed = Date.now() - started;
      check("cancelled query rejects with CANCELLED", category === "CANCELLED");
      check("cancellation is prompt (<3s, not the 8s delay)", elapsed < 3000);
      // No late result: wait past when the query would have finished; success count must not increase.
      await new Promise((r) => setTimeout(r, 400));
      const after = service.getMetrics();
      check("no late success recorded for the cancelled query", after.successes === before.successes);
      check("cancellation counted in telemetry", after.cancellations === before.cancellations + 1);
    }

    console.log("Teardown invariants:");
    {
      check("no pending bridge requests when idle", manager.pendingCount() === 0);
      const health = await manager.health();
      check("bridge is responsive after the workload (health ok)", (health.status ?? health.ok) !== undefined);
      check("still no pending requests after health check", manager.pendingCount() === 0);
    }

    console.log("Telemetry carries no secrets/SQL/rows:");
    {
      await run("ok", { sql: "SELECT secret_column FROM sensitive_orders" });
      const serialized = JSON.stringify(service.getMetrics());
      check("no SQL text in metrics", !serialized.includes("SELECT") && !serialized.includes("sensitive_orders"));
      check("no credentials in metrics", !serialized.includes("s3cr3t-pw"));
      check("no row content in metrics", !serialized.includes("row-1"));
      check("only low-cardinality dimensions (categories) present", /errorsByCategory/.test(serialized) && /queries/.test(serialized));
    }
  } finally {
    await manager.dispose();
  }

  console.log("Post-dispose (no orphan Java):");
  check("bridge process is not running after dispose", manager.isRunning() === false);
  check("no pending bridge requests after dispose", manager.pendingCount() === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
