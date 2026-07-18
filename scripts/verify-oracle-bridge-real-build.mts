/**
 * Real Oracle direct-JDBC executor build + load.
 *
 * The direct-JDBC executor (`OracleJdbcQueryExecutor`) references the Oracle driver ONLY via
 * Class.forName (a string), so it compiles against the plain JDK `java.sql` with no Oracle jars and is
 * ALWAYS compiled into the bridge jar. This verifier proves that (static contract + a clean compile),
 * asserts the removed UCP executor is gone, and — when a real ojdbc jar is vendored under
 * `resources/oracle-jdbc/lib/` — launches the bridge and proves the handshake reports REAL mode with a
 * real driver (no mock), then shuts down cleanly. A deliberately bad connection must map to a safe
 * error category, never mock rows.
 *
 * Run: `npm run verify:oracle-bridge-real-build`.
 */
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOracleBridge } from "./build-oracle-bridge.mjs";
import { oracleDriverJarsPresent } from "../src/oracle/OracleRuntimeResolver";
import { OracleJdbcBridgeManager, type BridgeLaunchSpec } from "../src/oracle/OracleJdbcBridgeManager";
import { OracleBridgeCallError } from "../src/oracle/OracleBridgeProtocol";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const isWin = process.platform === "win32";

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

const JAVA_ORACLE_EXEC_DIR = join(
  repoRoot,
  "oracle-jdbc-bridge",
  "src",
  "main",
  "java-oracle",
  "com",
  "specterstudio",
  "oracle",
  "bridge",
  "exec"
);
const UCP_EXECUTOR_SRC = join(JAVA_ORACLE_EXEC_DIR, "OracleUcpQueryExecutor.java");
const JDBC_EXECUTOR_SRC = join(JAVA_ORACLE_EXEC_DIR, "OracleJdbcQueryExecutor.java");

function staticContractChecks(): void {
  console.log("Static contract checks (direct-JDBC executor source + build wiring):");
  check("UCP executor is removed (no OracleUcpQueryExecutor.java)", !existsSync(UCP_EXECUTOR_SRC));
  check("direct-JDBC executor source exists at the java-oracle path", existsSync(JDBC_EXECUTOR_SRC));
  const src = existsSync(JDBC_EXECUTOR_SRC) ? readFileSync(JDBC_EXECUTOR_SRC, "utf8") : "";
  check("implements QueryExecutor", /implements\s+QueryExecutor/.test(src));
  check("reports executionMode 'real'", /return\s+"real"/.test(src));
  check("uses DriverManager (no UCP)", /DriverManager/.test(src) && !/oracle\.ucp/.test(src) && !/PoolDataSource/.test(src));
  check("opens + closes a connection per query", /DriverManager\.getConnection/.test(src) && /closeQuietly\(conn\)/.test(src));
  check("binds via PreparedStatement (no string-built SQL)", /PreparedStatement/.test(src) && !/createStatement\s*\(\s*\)/.test(src));
  check("sets read-only in depth", /setReadOnly\(true\)/.test(src));
  check("arms query timeout + cancellation", /setQueryTimeout/.test(src) && /\.cancel\(\)/.test(src));
  check("maps SQLException to safe categories", /mapSqlException/.test(src) && /ERR_AUTHENTICATION_FAILED|AUTHENTICATION_FAILED/.test(src));
  check("never concatenates SQL literals", !/"SELECT\s/.test(src.replace(/\/\/.*$/gm, "")));
  check("no ucpVersion() method (UCP removed)", !/ucpVersion\s*\(/.test(src));

  // Build wiring: java-oracle is ALWAYS compiled (the executor has no compile-time Oracle dependency);
  // there is no ucp gate anymore.
  const buildScript = readFileSync(join(repoRoot, "scripts", "build-oracle-bridge.mjs"), "utf8");
  check("build script compiles the java-oracle executor", /java-oracle/.test(buildScript) && /listJava\(oracleSrcDir\)/.test(buildScript));
  check("build script has no UCP gate", !/hasUcp/.test(buildScript) && !/OracleUcpQueryExecutor/.test(buildScript));
}

/**
 * Compile the direct-JDBC executor against the plain JDK `java.sql` + the built core classes — with NO
 * Oracle jars or stubs. This proves the real live-query path stays compilable in the network-blocked
 * environment (the executor references the Oracle driver only via Class.forName, a string).
 */
function compileJdbcExecutor(): void {
  console.log("Compilation (plain java.sql, no Oracle jars/stubs):");
  let built: { jdk: { javac: string }; classesDir: string; oracleCompiled: boolean };
  try {
    built = buildOracleBridge({ quiet: true }) as typeof built;
  } catch (err) {
    check(`core build available for compile (${(err as Error).message})`, false);
    return;
  }
  check("clean build compiles the direct-JDBC executor into the bridge jar", built.oracleCompiled === true);
  const tmp = mkdtempSync(join(tmpdir(), "awkit-oracle-jdbccompile-"));
  try {
    const jdbcOut = join(tmp, "jdbc-classes");
    mkdirSync(jdbcOut, { recursive: true });
    execFileSync(
      built.jdk.javac,
      ["-encoding", "UTF-8", "-cp", built.classesDir, "-d", jdbcOut, JDBC_EXECUTOR_SRC],
      { stdio: "pipe" }
    );
    check("direct-JDBC executor compiles clean against plain java.sql (no stubs)", true);
  } catch (err) {
    const msg = (err as { stderr?: Buffer; message?: string }).stderr?.toString() ?? (err as Error).message;
    console.log(`    javac output:\n${msg}`);
    check("direct-JDBC executor compiles clean against plain java.sql (no stubs)", false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function liveBuildAndHandshake(): Promise<void> {
  console.log("Live real build + handshake (vendored jars present):");
  const built = buildOracleBridge({ quiet: true });
  check("clean build compiled the real executor", built.oracleCompiled === true);

  const libDir = join(repoRoot, "resources", "oracle-jdbc", "lib");
  const jars = readdirSync(libDir).filter((f) => f.endsWith(".jar")).map((f) => join(libDir, f));
  const sep = isWin ? ";" : ":";
  const classpath = [built.jarPath, ...jars].join(sep);

  // Require real: the bridge must NOT fall back to mock. A real driver is present, so this should succeed.
  const spec: BridgeLaunchSpec = {
    javaPath: built.jdk.java,
    jarPath: built.jarPath,
    classpath,
    env: { AWKIT_ORACLE_REQUIRE_REAL: "1" }
  };
  const manager = new OracleJdbcBridgeManager({ resolveLaunchSpec: () => spec, requireRealDriver: true, handshakeTimeoutMs: 30_000 });
  try {
    const hello = await manager.hello();
    check("handshake reports executionMode 'real'", hello.executionMode === "real");
    check("driver available", hello.driverAvailable === true);
    check("reports a real driver version (not the mock)", typeof hello.driverVersion === "string" && hello.driverVersion !== "mock-0.1.0");

    // A deliberately unreachable target must map to a safe category — never mock rows.
    let category = "";
    try {
      await manager.call(
        "testConnection",
        { url: "jdbc:oracle:thin:@//127.0.0.1:1/DOES_NOT_EXIST", username: "nobody", password: "x" },
        { timeoutMs: 15_000 }
      );
    } catch (err) {
      category = err instanceof OracleBridgeCallError ? err.category : "UNKNOWN";
    }
    check("bad connection → safe error category (not mock success)", ["NETWORK_UNREACHABLE", "SERVICE_NOT_FOUND", "DRIVER_ERROR", "TIMEOUT", "INVALID_CONFIGURATION"].includes(category));
  } finally {
    await manager.dispose();
    check("clean shutdown (no throw)", true);
  }
}

async function main(): Promise<void> {
  staticContractChecks();

  if (oracleDriverJarsPresent(join(repoRoot, "resources"))) {
    await liveBuildAndHandshake();
  } else {
    compileJdbcExecutor();
    console.log("Live real build: SKIPPED — ojdbc jar not vendored (external gate).");
    console.log("  Import an ojdbc jar via Settings (or vendor one under resources/oracle-jdbc/lib/) for the live handshake.");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
