/**
 * Read-only SQL policy — TS/Java parity + adversarial corpus (Phase 04).
 *
 * Runs ONE corpus through BOTH policy engines and requires identical allow/deny decisions:
 *   - the TypeScript mirror `validateReadOnlySql` (rejects before the bridge is spawned), and
 *   - the AUTHORITATIVE Java `SqlReadOnlyPolicy` via the real Dispatcher `executeQuery` gate (a mock
 *     bridge process — an allowed statement reaches the mock executor and returns rows; a denied one
 *     comes back as SQL_POLICY_VIOLATION before the executor is ever called).
 *
 * The corpus exercises comments, string/identifier literals hiding keywords, Unicode whitespace,
 * semicolon multi-statement bypasses, `WITH FUNCTION`/`WITH PROCEDURE`, dangerous package calls, and
 * database links. Both engines must agree, and both must match the expected decision.
 *
 * Run: `npm run verify:oracle-sql-policy`.
 */
import { buildOracleBridge } from "./build-oracle-bridge.mjs";
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

interface Case {
  label: string;
  sql: string;
  allowed: boolean;
}

const NBSP = " ";
const CORPUS: Case[] = [
  // ── Allowed ──
  { label: "simple SELECT", sql: "SELECT * FROM orders", allowed: true },
  { label: "SELECT with WHERE", sql: "SELECT id, name FROM customers WHERE active = 1", allowed: true },
  { label: "WITH … SELECT (CTE)", sql: "WITH recent AS (SELECT id FROM orders) SELECT * FROM recent", allowed: true },
  { label: "keyword hidden in string literal", sql: "SELECT 'DELETE FROM x' AS note FROM dual", allowed: true },
  { label: "keyword hidden in line comment", sql: "SELECT 1 FROM dual -- DROP TABLE x", allowed: true },
  { label: "keyword hidden in block comment", sql: "SELECT /* UPDATE t */ col FROM t", allowed: true },
  { label: "Unicode NBSP whitespace", sql: `SELECT${NBSP}*${NBSP}FROM dual`, allowed: true },
  { label: "email in literal is not a dblink", sql: "SELECT * FROM users WHERE email = 'a@b.com'", allowed: true },
  { label: "@ inside quoted identifier is not a dblink", sql: 'SELECT * FROM "WEIRD@NAME"', allowed: true },
  { label: "trailing semicolon only", sql: "SELECT 1 FROM dual;", allowed: true },

  // ── Denied: DML/DDL ──
  { label: "INSERT", sql: "INSERT INTO t VALUES (1)", allowed: false },
  { label: "UPDATE", sql: "UPDATE t SET x = 1", allowed: false },
  { label: "DELETE", sql: "DELETE FROM t", allowed: false },
  { label: "MERGE", sql: "MERGE INTO t USING s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET t.x = s.x", allowed: false },
  { label: "DROP", sql: "DROP TABLE t", allowed: false },
  { label: "GRANT", sql: "GRANT SELECT ON t TO u", allowed: false },

  // ── Denied: multi-statement / locking ──
  { label: "multi-statement", sql: "SELECT * FROM t; DROP TABLE t", allowed: false },
  { label: "SELECT … FOR UPDATE", sql: "SELECT * FROM t FOR UPDATE", allowed: false },

  // ── Denied: PL/SQL ──
  { label: "anonymous BEGIN block", sql: "BEGIN NULL; END;", allowed: false },
  { label: "DECLARE block", sql: "DECLARE x NUMBER; BEGIN NULL; END;", allowed: false },
  { label: "CALL", sql: "CALL my_proc()", allowed: false },
  { label: "EXEC", sql: "EXEC dbms_stats.gather_schema_stats('X')", allowed: false },

  // ── Denied: inline PL/SQL in WITH (the Phase 04 gap) ──
  { label: "WITH FUNCTION", sql: "WITH FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END; SELECT f FROM dual", allowed: false },
  { label: "WITH PROCEDURE", sql: "WITH PROCEDURE p IS BEGIN NULL; END; SELECT 1 FROM dual", allowed: false },

  // ── Denied: dangerous packages ──
  { label: "UTL_HTTP (SSRF)", sql: "SELECT UTL_HTTP.REQUEST('http://x') FROM dual", allowed: false },
  { label: "DBMS_LOB", sql: "SELECT DBMS_LOB.GETLENGTH(col) FROM t", allowed: false },
  { label: "OWA_ (lowercase)", sql: "SELECT owa_util.get_cgi_env('X') FROM dual", allowed: false },

  // ── Denied: database link ──
  { label: "dblink @remote", sql: "SELECT * FROM scott.emp@remote_db", allowed: false },

  // ── Denied: empty ──
  { label: "empty SQL", sql: "", allowed: false }
];

async function javaAllows(manager: OracleJdbcBridgeManager, sql: string): Promise<boolean> {
  try {
    await manager.call("executeQuery", { sql, maxRows: 5, __simulate: { rows: 1 } }, { timeoutMs: 10_000 });
    return true; // reached the mock executor ⇒ the Java gate allowed it
  } catch (err) {
    if (err instanceof OracleBridgeCallError && err.category === "SQL_POLICY_VIOLATION") return false;
    // Any other category means the gate allowed it but execution failed for another reason.
    if (err instanceof OracleBridgeCallError) return true;
    throw err;
  }
}

async function main(): Promise<void> {
  console.log("Building the Java mock bridge…");
  const build = buildOracleBridge({ quiet: true });
  const spec: BridgeLaunchSpec = { javaPath: build.jdk.java, jarPath: build.jarPath, env: { AWKIT_ORACLE_BRIDGE_MOCK: "1" } };
  const manager = new OracleJdbcBridgeManager({ resolveLaunchSpec: () => spec, handshakeTimeoutMs: 20_000 });

  try {
    console.log("Corpus — TS mirror vs. authoritative Java gate:");
    let parityHolds = true;
    for (const c of CORPUS) {
      const ts = validateReadOnlySql(c.sql).allowed;
      const java = await javaAllows(manager, c.sql);
      const agree = ts === java;
      const matchesExpected = ts === c.allowed && java === c.allowed;
      if (!agree || !matchesExpected) parityHolds = false;
      check(
        `${c.label} → ${c.allowed ? "allow" : "deny"} (ts=${ts ? "allow" : "deny"}, java=${java ? "allow" : "deny"})`,
        agree && matchesExpected
      );
    }
    check("TS and Java reach identical decisions across the entire corpus", parityHolds);
  } finally {
    await manager.dispose();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
