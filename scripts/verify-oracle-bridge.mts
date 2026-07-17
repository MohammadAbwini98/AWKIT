/**
 * Oracle JDBC bridge contract checks (Phase 02). Builds the real Java bridge core with the pinned
 * JDK 17 and drives it over the framed stdin/stdout protocol with the database-free mock executor —
 * so handshake, health, query, SQL policy, error mapping, cancellation, oversized/malformed frames,
 * crash/restart, and clean shutdown are all exercised WITHOUT an Oracle database.
 *
 * Run: `npm run verify:oracle-bridge`.
 */
import { existsSync } from "node:fs";
import { buildOracleBridge } from "./build-oracle-bridge.mjs";
import {
  FrameDecoder,
  encodeFrame,
  ORACLE_BRIDGE_MAX_MESSAGE_BYTES,
  ORACLE_BRIDGE_PROTOCOL_VERSION
} from "../src/oracle/OracleBridgeProtocol";
import { OracleJdbcBridgeManager, type BridgeLaunchSpec } from "../src/oracle/OracleJdbcBridgeManager";
import { OracleBridgeCallError } from "../src/oracle/OracleBridgeProtocol";
import { validateReadOnlySql } from "../src/oracle/OracleSqlPolicy";

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
async function expectError(name: string, fn: () => Promise<unknown>, category: string): Promise<void> {
  try {
    await fn();
    check(`${name} (expected ${category})`, false);
  } catch (err) {
    const cat = err instanceof OracleBridgeCallError ? err.category : "n/a";
    check(`${name} → ${category}`, cat === category);
  }
}

async function main(): Promise<void> {
  console.log("Framing + protocol codec (pure):");
  {
    const dec = new FrameDecoder();
    const frame = encodeFrame({ v: 1, id: "abc", op: "hello" });
    // Split the frame across two chunks to prove incremental decoding.
    const a = frame.subarray(0, 3);
    const b = frame.subarray(3);
    check("partial chunk yields nothing", dec.push(a).length === 0);
    const out = dec.push(b);
    check("completed frame decodes one message", out.length === 1 && (out[0] as { id: string }).id === "abc");
    let oversizeThrown = false;
    try {
      const huge = Buffer.allocUnsafe(4);
      huge.writeUInt32BE(ORACLE_BRIDGE_MAX_MESSAGE_BYTES + 1, 0);
      new FrameDecoder().push(huge);
    } catch {
      oversizeThrown = true;
    }
    check("decoder rejects oversize declared length", oversizeThrown);
  }

  console.log("TS read-only SQL policy mirror:");
  check("SELECT allowed", validateReadOnlySql("SELECT * FROM dual").allowed);
  check("WITH … SELECT allowed", validateReadOnlySql("WITH t AS (SELECT 1 x FROM dual) SELECT x FROM t").allowed);
  check("INSERT rejected", !validateReadOnlySql("INSERT INTO t VALUES (1)").allowed);
  check("multiple statements rejected", !validateReadOnlySql("SELECT 1 FROM dual; DROP TABLE t").allowed);
  check("keyword inside a literal does not evade", validateReadOnlySql("SELECT 'DROP TABLE t' AS c FROM dual").allowed);
  check("SELECT … FOR UPDATE rejected", !validateReadOnlySql("SELECT * FROM t FOR UPDATE").allowed);

  console.log("Building bridge jar (pinned JDK 17)…");
  const build = buildOracleBridge({ quiet: true });
  check("bridge jar exists after build", existsSync(build.jarPath));

  const launchSpec: BridgeLaunchSpec = {
    javaPath: build.jdk.java,
    jarPath: build.jarPath,
    env: { AWKIT_ORACLE_BRIDGE_MOCK: "1" } // force the database-free executor for contract tests
  };
  const stderrLines: string[] = [];
  const manager = new OracleJdbcBridgeManager({
    resolveLaunchSpec: () => launchSpec,
    onStderr: (line) => stderrLines.push(line),
    handshakeTimeoutMs: 20_000
  });

  try {
    console.log("Handshake + health:");
    const hello = await manager.hello();
    check("protocol version matches", hello.protocolVersion === ORACLE_BRIDGE_PROTOCOL_VERSION);
    check("bridge reports mock driver unavailable", hello.driverAvailable === false);
    check("manager reports running", manager.isRunning());
    const health = await manager.health();
    check("health status ok", (health as { status?: string }).status === "ok");

    console.log("testConnection + executeQuery (mock):");
    const test = await manager.call("testConnection", { __simulate: {} });
    check("testConnection ok", (test as { ok?: boolean }).ok === true);

    const q = await manager.call("executeQuery", { sql: "SELECT * FROM t", maxRows: 100, __simulate: { rows: 3 } });
    check("executeQuery returns 3 rows", (q as { rowCount?: number }).rowCount === 3);
    check("executeQuery returns columns", Array.isArray((q as { columns?: unknown[] }).columns) && (q as { columns: unknown[] }).columns.length === 3);
    check("executeQuery not truncated", (q as { truncated?: boolean }).truncated === false);

    const truncated = await manager.call("executeQuery", { sql: "SELECT * FROM t", maxRows: 2, __simulate: { rows: 10 } });
    check("maxRows truncates + flags truncated", (truncated as { rowCount?: number }).rowCount === 2 && (truncated as { truncated?: boolean }).truncated === true);

    console.log("SQL policy + error mapping (authoritative Java side):");
    await expectError("bridge rejects INSERT", () => manager.call("executeQuery", { sql: "INSERT INTO t VALUES (1)" }), "SQL_POLICY_VIOLATION");
    await expectError("bridge rejects multi-statement", () => manager.call("executeQuery", { sql: "SELECT 1 FROM dual; DELETE FROM t" }), "SQL_POLICY_VIOLATION");
    await expectError(
      "simulated AUTHENTICATION_FAILED maps through",
      () => manager.call("executeQuery", { sql: "SELECT 1 FROM dual", __simulate: { error: "AUTHENTICATION_FAILED" } }),
      "AUTHENTICATION_FAILED"
    );
    await expectError("unsupported op rejected", () => manager.call("bogusOp" as never, {}), "UNSUPPORTED_OPERATION");

    console.log("Cancellation (prompt, no late result):");
    {
      const controller = new AbortController();
      const started = Date.now();
      const promise = manager.call(
        "executeQuery",
        { sql: "SELECT 1 FROM dual", __simulate: { rows: 1, delayMs: 8000 } },
        { signal: controller.signal }
      );
      setTimeout(() => controller.abort(), 150);
      let cancelled = false;
      try {
        await promise;
      } catch (err) {
        cancelled = err instanceof OracleBridgeCallError && err.category === "CANCELLED";
      }
      const elapsed = Date.now() - started;
      check("aborted query rejects with CANCELLED", cancelled);
      check("cancellation is prompt (<3s, not the 8s delay)", elapsed < 3000);
    }

    console.log("Timeout:");
    await expectError(
      "per-request timeout fires",
      () => manager.call("executeQuery", { sql: "SELECT 1 FROM dual", __simulate: { rows: 1, delayMs: 5000 } }, { timeoutMs: 300 }),
      "TIMEOUT"
    );

    console.log("Crash + bounded restart:");
    {
      // Kill the process out from under the manager; the next call must restart it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const child = (manager as any).live?.child;
      check("has a live child before crash", !!child);
      child?.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 300));
      check("manager notices the process is down", !manager.isRunning());
      const afterRestart = await manager.call("health", {}, { timeoutMs: 5000 });
      check("call after crash restarts the bridge", (afterRestart as { status?: string }).status === "ok");
      check("manager running again after restart", manager.isRunning());
    }

    console.log("Redaction:");
    check("stderr diagnostics carry no obvious secret", !stderrLines.join("\n").toLowerCase().includes("password"));
  } finally {
    await manager.dispose();
  }
  check("bridge disposed cleanly (not running)", !manager.isRunning());

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
